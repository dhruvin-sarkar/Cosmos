/** Small allocation-free transform helpers shared by render-kit materials. */
import * as THREE from 'three';

const invMatrix = new THREE.Matrix4();
const normalMatrix = new THREE.Matrix3();

/** Direction `worldDir` expressed in `object`'s local frame (normalized). Uses object.matrixWorld. */
export function worldDirectionToLocal(object: THREE.Object3D, worldDir: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  invMatrix.copy(object.matrixWorld).invert();
  normalMatrix.setFromMatrix4(invMatrix);
  return out.copy(worldDir).applyMatrix3(normalMatrix).normalize();
}

/** Camera position in `object`'s local frame (render camera world position via camera.matrixWorld). */
export function cameraPositionToLocal(object: THREE.Object3D, camera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
  invMatrix.copy(object.matrixWorld).invert();
  return out.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(invMatrix);
}
