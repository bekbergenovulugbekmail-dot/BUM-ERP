ALTER TABLE "customer_payments" ADD COLUMN "pos_shift_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_pos_shift_id_pos_shifts_id_fk" FOREIGN KEY ("pos_shift_id") REFERENCES "public"."pos_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cp_shift_idx" ON "customer_payments" USING btree ("pos_shift_id");