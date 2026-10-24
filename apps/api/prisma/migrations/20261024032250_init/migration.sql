-- CreateEnum
CREATE TYPE "Role" AS ENUM ('AUCTIONEER', 'BIDDER');

-- CreateEnum
CREATE TYPE "LotEventType" AS ENUM ('LOT_CREATED', 'BID_PLACED', 'LOT_CLOSED', 'LOT_CANCELLED');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('DEPOSIT', 'HOLD', 'RELEASE', 'PAYMENT', 'PAYOUT');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "user_id" UUID NOT NULL,
    "balance_cents" BIGINT NOT NULL DEFAULT 0,
    "committed_cents" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "balance_after_cents" BIGINT NOT NULL,
    "committed_after_cents" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "lot_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_items" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "category" TEXT,
    "attributes" JSONB NOT NULL,
    "external_url" TEXT,
    "image_url" TEXT,
    "image_data" BYTEA,
    "image_mime" TEXT,
    "reference_price_usd_cents" INTEGER,
    "raw" JSONB,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_search_cache" (
    "key" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "catalog_search_cache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "catalog_item_cache" (
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "catalog_item_cache_pkey" PRIMARY KEY ("source","external_id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "seller_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "starting_price_cents" BIGINT NOT NULL,
    "min_increment_cents" BIGINT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "original_ends_at" TIMESTAMPTZ(3) NOT NULL,
    "extension_count" INTEGER NOT NULL DEFAULT 0,
    "current_price_cents" BIGINT,
    "leader_id" UUID,
    "bid_count" INTEGER NOT NULL DEFAULT 0,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "winner_id" UUID,
    "final_price_cents" BIGINT,
    "chain_length" INTEGER NOT NULL,
    "chain_head_hash" TEXT NOT NULL,
    "chain_head_signature" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_events" (
    "id" BIGSERIAL NOT NULL,
    "lot_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" "LotEventType" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "actor_id" UUID,
    "actor" TEXT,
    "amount_cents" BIGINT,
    "data" JSONB NOT NULL,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "lot_id" UUID NOT NULL,
    "winner_id" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "wallet_transactions_user_id_created_at_idx" ON "wallet_transactions"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_source_external_id_key" ON "catalog_items"("source", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "lots_number_key" ON "lots"("number");

-- CreateIndex
CREATE INDEX "lots_starts_at_idx" ON "lots"("starts_at");

-- CreateIndex
CREATE INDEX "lots_ends_at_idx" ON "lots"("ends_at");

-- CreateIndex
CREATE INDEX "lots_seller_id_idx" ON "lots"("seller_id");

-- CreateIndex
CREATE UNIQUE INDEX "lot_events_hash_key" ON "lot_events"("hash");

-- CreateIndex
CREATE INDEX "lot_events_actor_id_type_idx" ON "lot_events"("actor_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "lot_events_lot_id_seq_key" ON "lot_events"("lot_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_code_key" ON "receipts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_lot_id_key" ON "receipts"("lot_id");

-- CreateIndex
CREATE INDEX "receipts_winner_id_idx" ON "receipts"("winner_id");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_events" ADD CONSTRAINT "lot_events_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_events" ADD CONSTRAINT "lot_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Regras de integridade que o banco garante sozinho (última linha de defesa).
-- ---------------------------------------------------------------------------

ALTER TABLE "wallets"
  ADD CONSTRAINT "wallets_committed_non_negative" CHECK ("committed_cents" >= 0),
  ADD CONSTRAINT "wallets_committed_within_balance" CHECK ("committed_cents" <= "balance_cents");

ALTER TABLE "lots"
  ADD CONSTRAINT "lots_starting_price_positive" CHECK ("starting_price_cents" > 0),
  ADD CONSTRAINT "lots_min_increment_positive" CHECK ("min_increment_cents" > 0),
  ADD CONSTRAINT "lots_window_valid" CHECK ("ends_at" > "starts_at");

-- Histórico append-only: bloqueia UPDATE/DELETE pela aplicação ou por engano.
-- Isso é defesa em profundidade: um DBA pode desligar o trigger, e é por isso que
-- a auditoria se baseia em hash encadeado + assinatura, e não neste trigger.
CREATE FUNCTION "lot_events_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'lot_events é append-only: % não é permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "lot_events_append_only"
  BEFORE UPDATE OR DELETE ON "lot_events"
  FOR EACH ROW EXECUTE FUNCTION "lot_events_append_only"();
