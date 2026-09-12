CREATE TABLE "product_images" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"content" "bytea" NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_images_size_check" CHECK ("product_images"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_images_company_idx" ON "product_images" USING btree ("company_id");