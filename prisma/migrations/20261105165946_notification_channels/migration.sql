-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsappNumber" TEXT;

-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT;
