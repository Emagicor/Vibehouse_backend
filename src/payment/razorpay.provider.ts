import Razorpay from 'razorpay';

export const RAZORPAY = 'RAZORPAY';

export const RazorpayProvider = {
  provide: RAZORPAY,
  useFactory: () => {
    return new Razorpay({
      key_id: process.env.RAZORPAY_TEST_API_KEY!,
      key_secret: process.env.RAZORPAY_TEST_API_SECRET!,
    });
  },
};
