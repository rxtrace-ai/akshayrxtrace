import { NextRequest } from 'next/server';
import { getAdminClient, fetchLatestOTP, deleteOTPById, markOTPVerified } from '@/lib/auth/otp';
import { fail, ok } from '@/lib/api/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Supabase admin client and helpers are centralized in lib/auth/otp

export async function POST(req: NextRequest) {
  try {
    const { email, otp } = await req.json();

    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return fail('INVALID_EMAIL', 'Invalid email address', 400);
    }

    if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
      return fail('INVALID_OTP_FORMAT', 'Invalid OTP format. Must be 6 digits.', 400);
    }

    const supabase = getAdminClient();

    // Fetch OTP record
    const { data: otpRecord, error: fetchError } = await fetchLatestOTP(email, supabase);

    if (fetchError) {
      console.error('Database fetch error:', fetchError);
      return fail('OTP_FETCH_FAILED', 'Failed to verify OTP. Please try again.', 500);
    }

    if (!otpRecord) {
      return fail('OTP_NOT_FOUND', 'No OTP found. Please request a new one.', 404);
    }

    // Check if OTP has expired
    const now = new Date();
    const expiresAt = new Date(otpRecord.expires_at);

    if (now > expiresAt) {
      // Delete expired OTP
      await deleteOTPById(otpRecord.id, supabase);

      return fail('OTP_EXPIRED', 'OTP has expired. Please request a new one.', 410);
    }

    // Verify OTP matches
    if (otpRecord.otp !== otp) {
      return fail('INVALID_OTP', 'Invalid OTP. Please check and try again.', 401);
    }

    // Mark OTP as verified in database
    const { error: updateError } = await markOTPVerified(otpRecord.id, supabase);

    if (updateError) {
      console.error('Update error:', updateError);
      return fail('OTP_VERIFY_UPDATE_FAILED', 'Failed to verify OTP. Please try again.', 500);
    }

    // Schedule deletion of OTP record after 1 hour (cleanup)
    setTimeout(async () => {
      try {
        await supabase
          .from('otp_verifications')
          .delete()
          .eq('id', otpRecord.id);
      } catch (err) {
        console.error('Cleanup error:', err);
      }
    }, 60 * 60 * 1000); // 1 hour

    return ok({
      message: 'Email verified successfully',
      email: email.toLowerCase(),
      verified_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

export async function GET(req: NextRequest) {
  return fail('METHOD_NOT_ALLOWED', 'Method not allowed. Use POST.', 405);
}
