import Razorpay from 'razorpay';

// Create Razorpay instance using secret keys from .env
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

export default async function handler(req, res) {

  // Allow only POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get format (pdf or docx) from request body
  const { format } = req.body;

  // Validate format
  if (!format || !['pdf', 'docx'].includes(format)) {
    return res.status(400).json({ error: 'Invalid format. Must be pdf or docx.' });
  }

  try {
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
    console.error('Payment order error:', err.message);

    if (err.statusCode === 401) {
      return res.status(500).json({ error: 'Invalid Razorpay keys. Check your .env file.' });
    }

    return res.status(500).json({ error: 'Could not create payment order. Please try again.' });
  }
}