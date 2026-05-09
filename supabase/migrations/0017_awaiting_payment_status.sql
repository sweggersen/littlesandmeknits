-- Step 1: Run this statement ALONE first, then run step 2.
alter type public.commission_request_status add value 'awaiting_payment' before 'awarded';
