// backend/src/api/controllers/auth.controller.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../../config/database"; // Import nomeado

const JWT_SECRET = process.env.JWT_SECRET || "super-secret";

export const register = async (req: Request, res: Response) => {
  const { username, password } = req.body;
  console.log(username, password);

  if (!username || !password) {
    return res
      .status(400)
      .json({ message: "Usuário e senha são obrigatórios." });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const newUser = await pool.query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username",
      [username, passwordHash]
    );
    res.status(201).json(newUser.rows[0]);
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Erro ao registar Usuário. ", error
      });
  }
};

export const login = async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ message: "Usuário e senha são obrigatórios." });
  }

  try {
    const userResult = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );
    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: "Credenciais inválidas." });
    }

    const user = userResult.rows[0];
    const isPasswordCorrect = await bcrypt.compare(
      password,
      user.password_hash
    );
    if (!isPasswordCorrect) {
      return res.status(401).json({ message: "Credenciais inválidas." });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    res.json({ token });
  } catch (error) {
    res.status(500).json({ message: "Erro interno no servidor." });
  }
};
