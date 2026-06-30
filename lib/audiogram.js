const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const TMP = '/tmp';

async function downloadToTmp(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const filePath = path.join(TMP, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function getDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      resolve(data.format.duration);
    });
  });
}

/**
 * Generates an audiogram MP4 from an audio file + square cover image.
 * @param {object} opts
 * @param {string} opts.audioUrl
 * @param {string} opts.imageUrl
 * @param {'square'|'vertical'} opts.format
 * @param {number} opts.durationLimit - max output length in seconds (default 60, 0 = no limit)
 * @returns {Promise<{ localPath: string, duration: number }>}
 */
async function generateAudiogram({ audioUrl, imageUrl, format = 'vertical', durationLimit = 60 }) {
  const jobTag = uuid();
  const audioExt = path.extname(new URL(audioUrl).pathname) || '.mp3';
  const imageExt = path.extname(new URL(imageUrl).pathname) || '.jpg';

  const audioPath = await downloadToTmp(audioUrl, `audio-${jobTag}${audioExt}`);
  const imagePath = await downloadToTmp(imageUrl, `cover-${jobTag}${imageExt}`);
  const outputPath = path.join(TMP, `output-${jobTag}.mp4`);

  const sourceDuration = await getDuration(audioPath);
  const clipDuration = durationLimit > 0 ? Math.min(sourceDuration, durationLimit) : sourceDuration;

  const filterComplex = format === 'square'
    ? '[0:v]scale=1080:1080,setsar=1,fps=25[bg];' +
      '[1:a]aformat=channel_layouts=stereo,showwaves=s=1080x200:mode=cline:rate=25:colors=2EC4B6@0.9[wave];' +
      '[bg][wave]overlay=0:880:shortest=1[out]'
    : '[0:v]scale=1080:1920,boxblur=20:20,fps=25[blurbg];' +
      '[0:v]scale=1080:1080,fps=25[cover];' +
      '[blurbg][cover]overlay=(W-w)/2:(H-h)/2[composite];' +
      '[1:a]aformat=channel_layouts=stereo,showwaves=s=1080x320:mode=cline:rate=25:colors=2EC4B6@0.8[wave];' +
      '[composite][wave]overlay=0:1600:shortest=1[out]';

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(imagePath).inputOptions(['-loop 1', '-framerate 25'])
      .input(audioPath)
      .complexFilter(filterComplex, ['out'])
      .outputOptions([
        '-map 1:a',
        '-c:v libx264',
        '-preset fast',
        '-crf 22',
        '-r 25',
        '-c:a aac',
        '-b:a 128k',
        '-shortest',
        `-t ${clipDuration}`,
        '-pix_fmt yuv420p',
      ])
      .save(outputPath)
      .on('end', resolve)
      .on('error', reject);
  });

  // cleanup inputs, keep output for upload step
  fs.unlinkSync(audioPath);
  fs.unlinkSync(imagePath);

  return { localPath: outputPath, duration: clipDuration, jobTag };
}

module.exports = { generateAudiogram };
