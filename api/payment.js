import Razorpay from 'razorpay';

const SUPPORTED_FORMATS = new Set(['pdf', 'doc']);
const DOWNLOAD_PRICE_PAISE = 4900;

export default async function handler(req, res) {

  // Allow only POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const format = typeof req.body?.format === 'string' ? req.body.format.toLowerCase() : '';

  if (!SUPPORTED_FORMATS.has(format)) {
    return res.status(400).json({ error: 'Invalid format. Must be pdf or doc.' });
  }

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return res.status(500).json({ error: 'Payment gateway is not configured.' });
  }

  try {
    {
      const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
      });

      const order = await razorpay.orders.create({
        amount: DOWNLOAD_PRICE_PAISE,
        currency: 'INR',
        receipt: `rf_${Date.now()}`,
        notes: {
          product: 'ResumeFriendly Export',
          format: format.toUpperCase(),
          website: process.env.SITE_DOMAIN || 'resumefriendly.in'
        }
      });

      return res.status(200).json({
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        receipt: order.receipt
      });
    }

    // Create Razorpay order
    const order = await razorpay.orders.create({
      amount:   4900,                           // ₹49 in paise (100 paise = ₹1)
      currency: 'INR',
      receipt:  'rf_' + Date.now(),             // Unique receipt ID
      notes: {
        product:  'ResumeFriendly Download',
        format:   format.toUpperCase(),
        website:  'resumefriendly.in'
      }
    });

    // Return order details to frontend
    return res.status(200).json({
      id:       order.id,
      amount:   order.amount,
      currency: order.currency,
      receipt:  order.receipt
    });

  } catch (err) {
    console.error('Payment order error:', err);

    if (err.statusCode === 401) {
      return res.status(500).json({ error: 'Razorpay keys are invalid.' });
    }

    return res.status(500).json({ error: 'Could not create payment order. Please try again.' });
  }
}
