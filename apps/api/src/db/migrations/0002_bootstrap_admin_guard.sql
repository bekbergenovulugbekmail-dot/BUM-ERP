ALTER TABLE "users" ADD COLUMN "is_bootstrap_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_single_bootstrap_admin_key" ON "users" USING btree ("is_bootstrap_admin") WHERE "users"."is_bootstrap_admin";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_bootstrap_admin_active_platform_admin" CHECK (NOT "users"."is_bootstrap_admin" OR ("users"."is_platform_admin" AND "users"."is_active"));--> statement-breakpoint
-- Qo'lda qo'shilgan (drizzle-kit triggerlarni generate qilmaydi):
-- bootstrap adminni o'chirish va bootstrap maqomini olib tashlash taqiqlanadi.
-- Adminlikni olish va bloklashni yuqoridagi CHECK to'xtatadi; telefon va parolni
-- yangilash (db:seed) ruxsat etilgan.
CREATE OR REPLACE FUNCTION "protect_bootstrap_admin"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_bootstrap_admin THEN
      RAISE EXCEPTION 'Bootstrap admin o''chirilmaydi' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_bootstrap_admin AND NOT NEW.is_bootstrap_admin THEN
    RAISE EXCEPTION 'Bootstrap admin maqomini olib bo''lmaydi' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "users_protect_bootstrap_admin" BEFORE UPDATE OR DELETE ON "users" FOR EACH ROW EXECUTE FUNCTION "protect_bootstrap_admin"();