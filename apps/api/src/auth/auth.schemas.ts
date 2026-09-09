import { z } from "zod";

const email = z.string().email().transform((e) => e.trim().toLowerCase());

export const RegisterSchema = z.object({ email, password: z.string().min(8) });
export const LoginSchema = z.object({ email, password: z.string().min(1) });
export const VerifyEmailSchema = z.object({ token: z.string().min(1) });
export const ResendVerificationSchema = z.object({ email });
export const ForgotPasswordSchema = z.object({ email });
export const ResetPasswordSchema = z.object({ token: z.string().min(1), password: z.string().min(8) });