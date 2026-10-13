import { sign, verify } from "hono/jwt";
import { config } from "../config.js";

export async function hashPassword(plain) {
  return Bun.password.hash(plain, { algorithm: "bcrypt", cost: 10 });
}

export async function verifyPassword(plain, hash) {
  return Bun.password.verify(plain, hash);
}

const JWT_ALG = "HS256";

export async function signToken(payload) {
  const exp = Math.floor(Date.now() / 1000) + config.jwtExpirySeconds;
  return sign({ ...payload, exp }, config.jwtSecret, JWT_ALG);
}

export async function verifyToken(token) {
  return verify(token, config.jwtSecret, JWT_ALG);
}
