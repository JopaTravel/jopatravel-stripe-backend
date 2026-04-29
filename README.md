# Railway Stripe Backend

Sube esta carpeta como backend de Railway para el carrito de Jopa Travel.

## Variables de entorno

- `STRIPE_SECRET_KEY=sk_live_...`
- `SITE_URL=https://www.jopatravel.com`

## Endpoints esperados

- `GET /`
- `GET /health`
- `POST /api/cart/store`
- `GET /api/cart/:cartId`
- `POST /api/create-checkout-session`

## Después del deploy

1. Copia la URL pública de Railway.
2. Reemplaza `BACKEND_BASE_URL` en tu carrito.
3. Prueba:
   - `https://tu-app.up.railway.app/health`
   - checkout desde `https://cart.jopatravel.com`
