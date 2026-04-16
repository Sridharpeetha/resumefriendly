export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  res.setHeader('Cache-Control', 'no-store');

  return res.status(200).json({
    paymentEnabled: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    supportedUploadFormats: ['pdf', 'doc', 'txt'],
    paidDownloadFormats: ['pdf', 'doc']
  });
}