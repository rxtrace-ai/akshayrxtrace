import { NextRequest } from 'next/server';
import { getAdminClient, generateOTP, getExpiryDate, clearExistingOTPs, insertOTP, sendOTPEmail } from '@/lib/auth/otp';
import { fail, ok } from '@/lib/api/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Supabase admin client and helpers are centralized in lib/auth/otp

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return fail('INVALID_EMAIL', 'Invalid email address', 400);
    }

    // Generate OTP and expiry
    const otp = generateOTP();
    const expiresAt = getExpiryDate(10);

    // Store OTP in database using service role client
    const supabase = getAdminClient();

    // Delete any existing OTPs for this email
    await clearExistingOTPs(email, supabase);

    // Insert new OTP
    const { error: dbError } = await insertOTP(email, otp, expiresAt, supabase);

    if (dbError) {
      console.error('Database error:', dbError);
      return fail('OTP_DB_ERROR', 'Failed to generate OTP. Please try again.', 500);
    }

    // Send email
    try {
      await sendOTPEmail(email, otp);
    } catch (emailError: any) {
      console.error('Email error details:', {
        message: emailError?.message,
        stack: emailError?.stack,
        code: emailError?.code,
        response: emailError?.response?.data
      });
      return fail('OTP_EMAIL_SEND_FAILED', 'Failed to send OTP email', 500);
    }

    return ok({
      message: 'OTP sent successfully',
      expiresIn: 600, // seconds
    });
  } catch (error) {
    console.error('Send OTP error:', error);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

// sendOTPEmail is imported from '@/lib/auth/otp'
