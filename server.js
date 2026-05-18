const express = require("express");
const Stripe = require("stripe");
const crypto = require("crypto");
const { Resend } = require("resend");

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
const HOST = process.env.HOST || "0.0.0.0";
const SITE_URL = process.env.SITE_URL || "https://www.jopatravel.com";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || "Reservations <reservations@mail.jopanauticos.com>";
const RESERVATION_NOTIFICATION_EMAIL =
  process.env.RESERVATION_NOTIFICATION_EMAIL || "pestevez@jopanauticos.com";
const CART_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const cartStore = new Map();
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

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

function formatUsd(total) {
  return "$" + Number(total || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + " USD";
}

function getLeadGuestContact(items, reservation) {
  const reservationData = reservation || {};
  const reservationName = String(
    reservationData.fullName || reservationData.name || reservationData.reservationName || ""
  ).trim();
  const reservationEmail = String(reservationData.email || reservationData.reservationEmail || "").trim();
  const reservationPhone = String(reservationData.phone || reservationData.mobile || "").trim();

  if (reservationName || reservationEmail || reservationPhone) {
    return {
      name: reservationName,
      email: reservationEmail,
      phone: reservationPhone
    };
  }

  const safeItems = Array.isArray(items) ? items : [];
  for (const item of safeItems) {
