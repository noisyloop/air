import { spawn } from 'node:child_process';

/** Thin promise wrappers around the ffmpeg/ffprobe CLIs (installed in the worker image). */

export function ffmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0));
  });
}

export function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-y', ...args]);
    let stderr = '';
    p.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    p.on('error', reject);
    p.on('exit', (code) =>
      code === 0 ? resolve(stderr) : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-2000)}`)),
    );
  });
}

export function runFfprobeJson(file: string): Promise<FfprobeResult> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format', '-show_streams',
      file,
    ]);
    let out = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString()));
    p.on('error', reject);
    p.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}`));
      try {
        resolve(JSON.parse(out) as FfprobeResult);
      } catch (e) {
        reject(e as Error);
      }
    });
  });
}

export interface FfprobeResult {
  format?: { duration?: string; bit_rate?: string; format_name?: string; tags?: Record<string, string> };
  streams?: Array<{ codec_type?: string; codec_name?: string; sample_rate?: string; channels?: number }>;
}

/** EBU R128 integrated loudness in LUFS, parsed from the loudnorm/ebur128 filter output. */
export async function measureLoudness(file: string): Promise<number | null> {
  try {
    const stderr = await runFfmpeg(['-i', file, '-af', 'ebur128', '-f', 'null', '-']);
    const match = stderr.match(/I:\s*(-?[\d.]+)\s*LUFS/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Waveform peaks: decode to raw 8kHz mono PCM and reduce to `buckets`
 * max-amplitude values in [0,1] — small enough to ship as JSON.
 */
export async function extractWaveformPeaks(file: string, buckets = 800): Promise<number[] | null> {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', [
      '-hide_banner', '-i', file,
      '-ac', '1', '-ar', '8000',
      '-f', 's16le', '-acodec', 'pcm_s16le',
      'pipe:1',
    ]);
    const chunks: Buffer[] = [];
    p.stdout.on('data', (d: Buffer) => chunks.push(d));
    p.on('error', () => resolve(null));
    p.on('exit', (code) => {
      if (code !== 0) return resolve(null);
      const pcm = Buffer.concat(chunks);
      const samples = Math.floor(pcm.length / 2);
      if (samples === 0) return resolve(null);
      const bucketSize = Math.max(1, Math.floor(samples / buckets));
      const peaks: number[] = [];
      for (let b = 0; b < buckets && b * bucketSize < samples; b++) {
        let max = 0;
        const end = Math.min(samples, (b + 1) * bucketSize);
        for (let i = b * bucketSize; i < end; i++) {
          const v = Math.abs(pcm.readInt16LE(i * 2));
          if (v > max) max = v;
        }
        peaks.push(Number((max / 32768).toFixed(3)));
      }
      resolve(peaks);
    });
  });
}
