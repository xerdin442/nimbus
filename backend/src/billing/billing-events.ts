export interface PaystackBillingEventData {
  id?: string | number;
  status?: string;
  reference?: string;
  amount?: number;
  currency?: string;
  created_at?: string;
  paid_at?: string | null;
  next_payment_date?: string | null;
  subscription_code?: string;
  email_token?: string;
  invoice_code?: string;
  authorization?: {
    authorization_code?: string;
  };
  customer?: {
    email?: string;
    customer_code?: string;
  };
  plan?: {
    plan_code?: string;
  };
  subscription?: {
    subscription_code?: string;
    email_token?: string;
    next_payment_date?: string | null;
    status?: string;
  };
  metadata?: {
    orgId?: string;
    planId?: string;
    subscriptionId?: string;
  };
}

export interface PaystackBillingEvent {
  event?: string;
  data?: PaystackBillingEventData;
}
