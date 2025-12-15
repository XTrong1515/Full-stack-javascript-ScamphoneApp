import express from 'express';
import {
  createVNPayPayment,
  vnpayIPN,
  vnpayReturn,
  createMomoPayment
} from '../Controllers/paymentController.js';
import { protect } from '../Middleware/authMiddleware.js';

const router = express.Router();

// VNPay routes
router.post('/vnpay/create', protect, createVNPayPayment);
router.get('/vnpay/ipn', vnpayIPN);
router.get('/vnpay/return', vnpayReturn);

// MoMo route
router.post('/momo', protect, createMomoPayment);

export default router;
