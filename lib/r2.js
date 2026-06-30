const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

/**
 * Uploads a local file to the R2 bucket and returns its public URL.
 * @param {string} localPath - path to the file on disk (/tmp/...)
 * @param {string} key - object key, e.g. `audiograms/{jobId}.mp4`
 * @param {string} contentType - e.g. 'video/mp4'
 */
async function uploadToR2(localPath, key, contentType = 'video/mp4') {
  const body = fs.readFileSync(localPath);

  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));

  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

module.exports = { uploadToR2 };
