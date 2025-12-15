import { api } from './api';

export const paymentService = {
  createMomoPayment: async (orderId: string, amount: number) => {
    const { data } = await api.post('/payment/momo', { orderId, amount });
    return data;
  },
};