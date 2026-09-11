CREATE UNIQUE INDEX "ca_one_default_per_company_key" ON "cash_accounts" USING btree ("company_id") WHERE "cash_accounts"."is_default";--> statement-breakpoint
-- Qo'lda qo'shilgan (drizzle-kit triggerlarni generate qilmaydi):
-- o'tkazilgan (posted) buxgalteriya yozuvi tranzaksiya OXIRIDA tekshiriladi —
-- kamida 2 qator, qatorlar yig'indisi sarlavhadagi jamiga teng, debet = kredit.
-- Kechiktirilgan: sarlavha va qatorlar bitta tranzaksiyada ketma-ket yoziladi.
-- Convex'dan ko'chirilgan (legacy_id bor) yozuvlarga ±1 so'm farq ruxsat — Convex float bilan shunday yozgan.
CREATE OR REPLACE FUNCTION "check_journal_entry_balanced"() RETURNS trigger AS $$
DECLARE
  v_entry uuid;
  v_status journal_status;
  v_legacy varchar;
  v_total_debit numeric;
  v_total_credit numeric;
  v_sum_debit numeric;
  v_sum_credit numeric;
  v_count int;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    v_entry := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_entry := OLD.entry_id;
  ELSE
    v_entry := NEW.entry_id;
  END IF;

  SELECT status, legacy_id, total_debit, total_credit
    INTO v_status, v_legacy, v_total_debit, v_total_credit
    FROM journal_entries WHERE id = v_entry;
  IF NOT FOUND OR v_status <> 'posted' THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*)
    INTO v_sum_debit, v_sum_credit, v_count
    FROM journal_lines WHERE entry_id = v_entry;

  IF v_count < 2
     OR v_sum_debit <> v_total_debit
     OR v_sum_credit <> v_total_credit
     OR (v_sum_debit <> v_sum_credit AND (v_legacy IS NULL OR abs(v_sum_debit - v_sum_credit) > 1)) THEN
    RAISE EXCEPTION 'Buxgalteriya yozuvi balanslanmagan (%): debet %, kredit %', v_entry, v_sum_debit, v_sum_credit
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "journal_lines_balanced" AFTER INSERT OR UPDATE OR DELETE ON "journal_lines" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_journal_entry_balanced"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "journal_entries_balanced" AFTER INSERT OR UPDATE ON "journal_entries" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_journal_entry_balanced"();