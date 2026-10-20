/** Hero-galaxy star-cloud build off the main thread (image decode + getImageData + sampling: ~190 ms on the M31 approach). */
import { buildCloudFromImage, type CloudJob } from './starCloudsAsync';

self.onmessage = (e: MessageEvent<CloudJob>) => {
  void buildCloudFromImage(e.data).then(
    (r) => (self as unknown as Worker).postMessage(r, [r.positions.buffer, r.colors.buffer]),
    (err: unknown) => (self as unknown as Worker).postMessage({ error: String(err) }),
  );
};
