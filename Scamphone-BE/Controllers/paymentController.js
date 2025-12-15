import asyncHandler from 'express-async-handler';
import crypto from 'crypto';
import querystring from 'qs';
import Order from '../Models/OrderModel.js';
import axios from 'axios';

// VNPay configuration
const vnpayConfig = {
  vnp_TmnCode: process.env.VNP_TMN_CODE || 'DEMO_TMN_CODE',
  vnp_HashSecret: process.env.VNP_HASH_SECRET || 'DEMO_HASH_SECRET',
  vnp_Url: process.env.VNP_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
  vnp_ReturnUrl: process.env.VNP_RETURN_URL || 'http://localhost:5173'
};

// @desc    Create VNPay payment URL
// @route   POST /api/v1/payment/vnpay/create
// @access  Private
const createVNPayPayment = asyncHandler(async (req, res) => {
  const { orderId, amount, bankCode, language = 'vn', orderInfo } = req.body;

  if (!orderId || !amount) {
    res.status(400);
    throw new Error('Missing required fields: orderId and amount');
  }

  // Verify order exists
  const order = await Order.findById(orderId);
  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  // Check if order belongs to user
  if (order.user.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorized');
  }

  // Get IP address (following VNPay spec)
  let ipAddr = req.headers['x-forwarded-for'] ||
               req.connection.remoteAddress ||
               req.socket.remoteAddress ||
               req.connection.socket.remoteAddress;
  
  // If IPv6, convert to IPv4
  if (ipAddr && ipAddr.includes('::ffff:')) {
    ipAddr = ipAddr.split('::ffff:')[1];
  }

  const date = new Date();
  const createDate = formatDate(date);
  const orderId_vnpay = date.getTime().toString();

  let vnp_Params = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: vnpayConfig.vnp_TmnCode,
    vnp_Locale: language || 'vn',
    vnp_CurrCode: 'VND',
    vnp_TxnRef: orderId_vnpay,
    vnp_OrderInfo: orderInfo || `Thanh toan don hang ${orderId}`,
    vnp_OrderType: 'other',
    vnp_Amount: amount * 100, // VNPay expects amount in smallest unit (VND x 100)
    vnp_ReturnUrl: vnpayConfig.vnp_ReturnUrl,
    vnp_IpAddr: ipAddr || '127.0.0.1',
    vnp_CreateDate: createDate
  };

  // Add bankCode if provided
  if (bankCode) {
    vnp_Params.vnp_BankCode = bankCode;
  }

  // CRITICAL: Sort parameters alphabetically before signing
  vnp_Params = sortObject(vnp_Params);

  // Create signature using HMAC SHA512
  const signData = querystring.stringify(vnp_Params, { encode: false });
  const hmac = crypto.createHmac('sha512', vnpayConfig.vnp_HashSecret);
  const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
  vnp_Params['vnp_SecureHash'] = signed;

  // Create payment URL
  const paymentUrl = vnpayConfig.vnp_Url + '?' + querystring.stringify(vnp_Params, { encode: false });

  console.log('[VNPAY] Payment URL created:', paymentUrl.substring(0, 100) + '...');
  console.log('[VNPAY] Return URL:', vnpayConfig.vnp_ReturnUrl);
  console.log('[VNPAY] TMN Code:', vnpayConfig.vnp_TmnCode);
  console.log('[VNPAY] Order ID (MongoDB):', orderId);
  console.log('[VNPAY] TxnRef (VNPay):', orderId_vnpay);

  // Store mapping between MongoDB orderId and VNPay TxnRef
  order.paymentTransactionId = orderId_vnpay;
  await order.save();

  res.json({
    success: true,
    paymentUrl,
    orderId: orderId_vnpay
  });
});

// @desc    Handle VNPay IPN (Instant Payment Notification)
// @route   GET /api/v1/payment/vnpay/ipn
// @access  Public (called by VNPay)
const vnpayIPN = asyncHandler(async (req, res) => {
  let vnp_Params = req.query;
  const secureHash = vnp_Params['vnp_SecureHash'];

  delete vnp_Params['vnp_SecureHash'];
  delete vnp_Params['vnp_SecureHashType'];

  vnp_Params = sortObject(vnp_Params);

  const signData = querystring.stringify(vnp_Params, { encode: false });
  const hmac = crypto.createHmac('sha512', vnpayConfig.vnp_HashSecret);
  const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

  if (secureHash === signed) {
    const orderId = vnp_Params['vnp_TxnRef'];
    const rspCode = vnp_Params['vnp_ResponseCode'];

    // Find order and update payment status
    // Note: vnp_TxnRef is the timestamp we generated, not MongoDB _id
    // You may need to store this mapping in your Order model
    
    if (rspCode === '00') {
      // Payment success
      res.status(200).json({ RspCode: '00', Message: 'Success' });
    } else {
      // Payment failed
      res.status(200).json({ RspCode: '01', Message: 'Failed' });
    }
  } else {
    res.status(200).json({ RspCode: '97', Message: 'Invalid signature' });
  }
});

// @desc    Handle VNPay return URL
// @route   GET /api/v1/payment/vnpay/return
// @access  Public
const vnpayReturn = asyncHandler(async (req, res) => {
  let vnp_Params = { ...req.query };
  const secureHash = vnp_Params['vnp_SecureHash'];

  // Remove hash fields for verification
  delete vnp_Params['vnp_SecureHash'];
  delete vnp_Params['vnp_SecureHashType'];

  // CRITICAL: Sort parameters alphabetically
  vnp_Params = sortObject(vnp_Params);

  // Verify signature
  const signData = querystring.stringify(vnp_Params, { encode: false });
  const hmac = crypto.createHmac('sha512', vnpayConfig.vnp_HashSecret);
  const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

  if (secureHash.toUpperCase() === signed.toUpperCase()) {
    const rspCode = vnp_Params['vnp_ResponseCode'];
    const txnRef = vnp_Params['vnp_TxnRef']; // VNPay transaction reference
    const amount = parseInt(vnp_Params['vnp_Amount']) / 100;
    const transactionNo = vnp_Params['vnp_TransactionNo'];

    console.log('[VNPAY Return] Response Code:', rspCode);
    console.log('[VNPAY Return] TxnRef:', txnRef);
    console.log('[VNPAY Return] Amount:', amount);

    // Payment successful
    if (rspCode === '00') {
      try {
        // Find order by paymentTransactionId (we stored this when creating payment)
        const order = await Order.findOne({ paymentTransactionId: txnRef });
        
        if (order) {
          // Update order status
          order.isPaid = true;
          order.paidAt = new Date();
          order.paymentMethod = 'VNPay';
          order.status = 'processing'; // Move from pending to processing
          order.paymentTransactionId = transactionNo; // Update with actual VNPay transaction number
          
          await order.save();
          
          console.log('[VNPAY] Order updated successfully:', order._id);
          
          res.json({
            success: true,
            code: rspCode,
            message: 'Thanh toán thành công',
            orderId: order._id.toString(),
            amount,
            transactionNo
          });
        } else {
          console.error('[VNPAY] Order not found with TxnRef:', txnRef);
          res.json({
            success: false,
            code: '01',
            message: 'Không tìm thấy đơn hàng',
            txnRef
          });
        }
      } catch (error) {
        console.error('[VNPAY] Error updating order:', error);
        res.status(500).json({
          success: false,
          message: 'Lỗi cập nhật đơn hàng',
          error: error.message
        });
      }
    } else {
      // Payment failed
      res.json({
        success: false,
        code: rspCode,
        message: 'Thanh toán thất bại',
        txnRef
      });
    }
  } else {
    console.error('[VNPAY] Invalid signature');
    res.status(400).json({
      success: false,
      message: 'Chữ ký không hợp lệ'
    });
  }
});

// @desc    Create MoMo payment URL
// @route   POST /api/v1/payment/momo
// @access  Private
const createMomoPayment = asyncHandler(async (req, res) => {
    const { orderId, amount } = req.body;
    if (!orderId || !amount) {
        res.status(400);
        throw new Error('Missing required fields: orderId and amount');
    }
    const partnerCode = process.env.MOMO_PARTNER_CODE;
    const accessKey = process.env.MOMO_ACCESS_KEY;
    const secretkey = process.env.MOMO_SECRET_KEY;
    const requestId = partnerCode + new Date().getTime();
    const momoOrderId = requestId;
    const orderInfo = `Thanh toan don hang ${orderId}`;
    const redirectUrl = `${process.env.CLIENT_URL}/payment-result`;
    const ipnUrl = `${process.env.API_URL}/api/v1/payment/momo-ipn`;
    const requestType = 'captureWallet';
    const extraData = '';

    const rawSignature = `accessKey=${accessKey}&amount=${amount}&extraData=${extraData}&ipnUrl=${ipnUrl}&orderId=${momoOrderId}&orderInfo=${orderInfo}&partnerCode=${partnerCode}&redirectUrl=${redirectUrl}&requestId=${requestId}&requestType=${requestType}`;

    const signature = crypto.createHmac('sha256', secretkey)
        .update(rawSignature)
        .digest('hex');

    const requestBody = JSON.stringify({
        partnerCode,
        accessKey,
        requestId,
        amount: amount.toString(),
        orderId: momoOrderId,
        orderInfo,
        redirectUrl,
        ipnUrl,
        extraData,
        requestType,
        signature,
        lang: 'en'
    });

    try {
        const { data } = await axios.post(process.env.MOMO_ENDPOINT, requestBody, {
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody)
            }
        });

        res.json({ payUrl: data.payUrl });
    } catch (error) {
        res.status(500);
        throw new Error('MoMo payment creation failed');
    }
});


// Helper functions
function sortObject(obj) {
  const sorted = {};
  const keys = Object.keys(obj).sort();
  keys.forEach(key => {
    sorted[key] = obj[key];
  });
  return sorted;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

export {
  createVNPayPayment,
  vnpayIPN,
  vnpayReturn,
  createMomoPayment,
};
