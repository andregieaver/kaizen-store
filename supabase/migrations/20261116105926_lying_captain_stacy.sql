CREATE TABLE "commerce"."store_traffic_hourly" (
	"store_id" uuid NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"server_errors" integer DEFAULT 0 NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	CONSTRAINT "store_traffic_hourly_store_id_hour_pk" PRIMARY KEY("store_id","hour"),
	CONSTRAINT "store_traffic_hourly_counts" CHECK ("commerce"."store_traffic_hourly"."requests" >= 0 and "commerce"."store_traffic_hourly"."server_errors" >= 0 and "commerce"."store_traffic_hourly"."server_errors" <= "commerce"."store_traffic_hourly"."requests")
);
--> statement-breakpoint
ALTER TABLE "commerce"."store_traffic_hourly" ADD CONSTRAINT "store_traffic_hourly_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_traffic_hourly_hour_idx" ON "commerce"."store_traffic_hourly" USING btree ("hour");--> statement-breakpoint
-- Row-level security, no policy: the commerce schema is private to the server.
ALTER TABLE "commerce"."store_traffic_hourly" ENABLE ROW LEVEL SECURITY;
