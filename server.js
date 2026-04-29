const express = require("express");
const Stripe = require("stripe");
const crypto = require("crypto");

const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json());

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const PORT = process.env.PORT || 3000;
const SITE_URL = process.env.SITE_URL || "https://www.jopatravel.com";
const CART_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const cartStore = new Map();

function cleanupExpiredCarts() {
  const now = Date.now();

  for (const [cartId, entry] of cartStore.entries()) {
    if (!entry || !entry.updatedAt || now - entry.updatedAt > CART_TTL_MS) {
      cartStore.delete(cartId);
    }
  }
}

function generateCartId() {
  return "cart_" + crypto.randomBytes(12).toString("hex");
}

function getNormalizedItems(cart) {
  const items = Array.isArray(cart && cart.items) ? cart.items : [];

  return items
    .filter((item) => {
      const quantity = Number((item && item.quantity) || 0);
      const unitAmount = Number((item && item.unitAmount) || 0);
      return quantity > 0 && unitAmount > 0;
    })
    .map((item) => ({
      name: item.name || "Jopa Travel Reservation",
      quantity: Number(item.quantity || 0),
      unitAmount: Number(item.unitAmount || 0),
      metadata: item.metadata || {},
      passengers: Number(item.passengers || item.quantity || 0)
    }));
}

function buildCartSummary(items) {
  return {
    products: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    passengers: items.reduce((sum, item) => sum + Number(item.passengers || item.quantity || 0), 0),
    total: items.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unitAmount || 0)) / 100, 0)
  };
}

function saveCart({ cartId, reservation, cart, source }) {
  cleanupExpiredCarts();

  const normalizedItems = getNormalizedItems(cart);
  if (!normalizedItems.length) {
    return null;
  }

  const now = Date.now();
  const nextCartId = cartId || generateCartId();
  const summary = buildCartSummary(normalizedItems);
  const previousEntry = cartStore.get(nextCartId);

  const entry = {
    id: nextCartId,
    reservation: reservation || {},
    cart: {
      currency: (cart && cart.currency) || "usd",
      items: normalizedItems
    },
    source: source || "",
    createdAt: previousEntry ? previousEntry.createdAt : now,
    updatedAt: now,
    summary
  };

  cartStore.set(nextCartId, entry);
  return entry;
}

function getStoredCart(cartId) {
  cleanupExpiredCarts();

  if (!cartId || !cartStore.has(cartId)) {
    return null;
  }

  return cartStore.get(cartId);
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "jopatravel-stripe-backend"
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    stripeConfigured: Boolean(STRIPE_SECRET_KEY),
    siteUrl: SITE_URL,
    cartStoreSize: cartStore.size
  });
});

app.post("/api/cart/store", (req, res) => {
  try {
    const body = req.body || {};
    const entry = saveCart({
      cartId: body.cartId || "",
      reservation: body.reservation || {},
      cart: body.cart || {},
      source: body.source || ""
    });

    if (!entry) {
      return res.status(400).json({ error: "No valid cart items received." });
    }

    res.json({
      ok: true,
      cartId: entry.id,
      summary: entry.summary,
      cartUrl: `${SITE_URL}/jopacart?cart_id=${encodeURIComponent(entry.id)}`
    });
  } catch (error) {
    res.status(500).json({
      error: error && error.message ? error.message : "Cart could not be stored."
    });
  }
});

app.get("/api/cart/:cartId", (req, res) => {
  const entry = getStoredCart(req.params.cartId);

  if (!entry) {
    return res.status(404).json({ error: "Cart not found." });
  }

  res.json({
    ok: true,
    cartId: entry.id,
    reservation: entry.reservation,
    cart: entry.cart,
    summary: entry.summary,
    source: entry.source || ""
  });
});

app.post("/api/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({
        error: "Stripe secret key is missing on the server."
      });
    }

    const body = req.body || {};
    const storedCart = body.cartId ? getStoredCart(body.cartId) : null;
    const reservation = storedCart ? storedCart.reservation || {} : body.reservation || {};
    const cart = storedCart ? storedCart.cart || {} : body.cart || {};
    const items = getNormalizedItems(cart);

    if (!items.length) {
      return res.status(400).json({ error: "No cart items received." });
    }

    const lineItems = items.map((item) => ({
      price_data: {
        currency: cart.currency || "usd",
        product_data: {
          name: item.name || "Jopa Travel Reservation",
          metadata: item.metadata || {}
        },
        unit_amount: item.unitAmount
      },
      quantity: item.quantity || 1
    }));

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: body.successUrl || `${SITE_URL}/thank-you?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: body.cancelUrl || `${SITE_URL}/jopacart`,
      customer_email: reservation.email || undefined,
      payment_method_types: ["card"],
      line_items: lineItems,
      metadata: {
        full_name: reservation.fullName || "",
        phone: reservation.phone || "",
        hotel: reservation.hotel || "",
        room_number: reservation.roomNumber || "",
        reservation_date: reservation.reservationDate || "",
        preferred_departure_time: reservation.preferredDepartureTime || "",
        adults: String(reservation.adults || 0),
        children: String(reservation.children || 0),
        passengers: String(reservation.passengers || 0)
      }
    });

    res.json({ id: session.id, url: session.url });
  } catch (error) {
    res.status(500).json({
      error: error && error.message ? error.message : "Stripe session creation failed."
    });
  }
});

app.listen(PORT, () => {
  console.log("Stripe backend running on port " + PORT);
  console.log("Stripe configured:", Boolean(STRIPE_SECRET_KEY));
});
