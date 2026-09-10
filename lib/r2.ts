import { S3Client } from '@aws-sdk/client-s3'

// R2 is S3-compatible, so we use the AWS S3 SDK pointed at Cloudflare's endpoint
export const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})
