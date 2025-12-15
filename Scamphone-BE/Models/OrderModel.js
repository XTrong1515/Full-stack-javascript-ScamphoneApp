import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema({
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true },
    image: { type: String },
    // Thông tin biến thể (nếu khách hàng mua variant cụ thể)
    variantAttributes: { type: Map, of: String }, // { "Màu sắc": "Đen", "Dung lượng": "256GB" }
    sku: { type: String } // Mã SKU của variant (nếu có)
});

const shippingAddressSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String },
    district: { type: String }
}, { _id: false });

const deliveryPersonSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true },
    vehicleNumber: { type: String }, // Biển số xe
    assignedAt: { type: Date, default: Date.now }
}, { _id: false });

// Schema cho thông tin giao hàng (theo yêu cầu prompt)
const shippingDetailsSchema = new mongoose.Schema({
    driverName: { type: String }, // Tên tài xế
    driverPhone: { type: String }, // SĐT tài xế
    vehicleNumber: { type: String }, // Biển số xe (Tùy chọn)
    shippedAt: { type: Date } // Thời điểm bắt đầu giao
}, { _id: false });

// Schema cho thông tin hoàn tiền
const refundInfoSchema = new mongoose.Schema({
    bankName: { type: String, required: true }, // Tên ngân hàng
    accountNumber: { type: String, required: true }, // Số tài khoản
    accountName: { type: String, required: true }, // Tên chủ tài khoản
    requestedAt: { type: Date, default: Date.now }, // Thời điểm yêu cầu
    processedAt: { type: Date }, // Thời điểm xử lý
    status: { 
        type: String, 
        enum: ['pending', 'approved', 'rejected', 'completed'],
        default: 'pending'
    },
    adminNote: { type: String } // Ghi chú từ admin
}, { _id: false });

const orderSchema = new mongoose.Schema({
    orderNumber: { type: Number, unique: true }, // Số thứ tự đơn hàng: 1, 2, 3...
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    orderItems: [orderItemSchema],
    shippingAddress: { type: shippingAddressSchema, required: true },
    paymentMethod: { 
        type: String, 
        enum: ["COD", "BANK_TRANSFER", "Cash", "MOMO"],
        default: "COD"
    },
    // Thông tin mã giảm giá
    discount: {
        code: { type: String },
        discountId: { type: mongoose.Schema.Types.ObjectId, ref: "Discount" },
        amount: { type: Number, default: 0 },
        type: { type: String, enum: ['percentage', 'fixed_amount', 'free_shipping'] }
    },
    totalPrice: { type: Number, required: true },
    status: {
        type: String,
        enum: ["pending", "processing", "shipping", "delivered", "cancelled", "refund_pending", "refunded"],
        default: "pending"
    },
    rejectionReason: { type: String },
    cancelReason: { type: String },
    cancelledBy: { type: String, enum: ['user', 'admin'], default: null },
    cancelledAt: { type: Date },
    isPaid: { type: Boolean, default: false },
    paidAt: { type: Date },
    paymentTransactionId: { type: String }, // Transaction ID
    // Thông tin hoàn tiền
    refundInfo: { type: refundInfoSchema, default: null },
    isDelivered: { type: Boolean, default: false },
    deliveredAt: { type: Date },
    // Thông tin người giao hàng
    deliveryPerson: { type: deliveryPersonSchema, default: null },
    // Thông tin chi tiết giao hàng (theo yêu cầu prompt)
    shippingDetails: { type: shippingDetailsSchema, default: null }
}, { timestamps: true });

// Auto-increment orderNumber trước khi save
orderSchema.pre('save', async function(next) {
    if (this.isNew && !this.orderNumber) {
        try {
            // Tìm đơn hàng cuối cùng để lấy số thứ tự
            const lastOrder = await this.constructor.findOne({}, { orderNumber: 1 })
                .sort({ orderNumber: -1 })
                .limit(1);
            
            this.orderNumber = lastOrder ? lastOrder.orderNumber + 1 : 1;
        } catch (error) {
            return next(error);
        }
    }
    next();
});

// Virtual field để format order number thành #0001
orderSchema.virtual('formattedOrderNumber').get(function() {
    return `#${String(this.orderNumber).padStart(4, '0')}`;
});

// Đảm bảo virtuals được serialize khi convert to JSON
orderSchema.set('toJSON', { virtuals: true });
orderSchema.set('toObject', { virtuals: true });

export default mongoose.model("Order", orderSchema);
