// src/pipeline/homography.js — homografía 3x3 por eliminación gaussiana.
// Hoja pura: no importa nada nuestro.

export function solveLinearSystem(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
    }
    if (maxRow !== i) [M[i], M[maxRow]] = [M[maxRow], M[i]];
    if (Math.abs(M[i][i]) < 1e-10) throw new Error("Sistema singular");
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

export function computeHomography(dstPoints, srcPoints) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y }     = dstPoints[i];
    const { x: u, y: v } = srcPoints[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
  }
  const h = solveLinearSystem(A, b);
  return [...h, 1];
}

export function isNearlyAxisRect(corners, tol = 0.008) {
  return Math.abs(corners[0].y - corners[1].y) < tol
      && Math.abs(corners[2].y - corners[3].y) < tol
      && Math.abs(corners[0].x - corners[3].x) < tol
      && Math.abs(corners[1].x - corners[2].x) < tol;
}