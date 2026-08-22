import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createTransport, type Transporter } from "nodemailer";

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>("SMTP_HOST")?.trim();
    if (!host) return;

    const port = Number(this.config.get<string>("SMTP_PORT") ?? "587");
    const user = this.config.get<string>("SMTP_USER");
    const pass = this.config.get<string>("SMTP_PASS");

    this.transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  async sendUserInvite(opts: {
    to: string;
    inviteUrl: string;
    roleLabel: string;
    organizationName: string;
  }): Promise<boolean> {
    const from = this.config.get<string>("MAIL_FROM") ?? "POPS <noreply@pops.local>";
    const subject = `You're invited to ${opts.organizationName} on POPS`;
    const text = [
      `You've been invited to join ${opts.organizationName} on POPS Restaurant ERP.`,
      `Role: ${opts.roleLabel}`,
      ``,
      `Open this link to set your password and activate your account (expires in 7 days):`,
      opts.inviteUrl,
    ].join("\n");

    const html = `
      <p>You've been invited to join <strong>${opts.organizationName}</strong> on POPS Restaurant ERP.</p>
      <p>Role: <strong>${opts.roleLabel}</strong></p>
      <p><a href="${opts.inviteUrl}">Accept invitation and set your password</a></p>
      <p style="color:#666;font-size:12px">This link expires in 7 days.</p>
    `;

    if (!this.transporter) {
      this.logger.log(`[dev] Invite email for ${opts.to}\n${opts.inviteUrl}`);
      return false;
    }

    await this.transporter.sendMail({ from, to: opts.to, subject, text, html });
    return true;
  }

  async sendLicencePaymentReminder(opts: {
    to: string;
    businessName: string;
    periodLabel: string;
    expiresAt: string | null;
    daysLeft: number | null;
    kind: "month_end" | "due";
  }): Promise<boolean> {
    const from = this.config.get<string>("MAIL_FROM") ?? "POPS <noreply@pops.local>";
    const subject =
      opts.kind === "due"
        ? `POPS licence expiring soon — ${opts.businessName}`
        : `POPS monthly payment due — ${opts.businessName} (${opts.periodLabel})`;

    const expiryLine = opts.expiresAt
      ? `Licence expiry: ${new Date(opts.expiresAt).toLocaleDateString()} (${
          opts.daysLeft != null
            ? opts.daysLeft < 0
              ? `expired ${Math.abs(opts.daysLeft)} day(s) ago`
              : `${opts.daysLeft} day(s) left`
            : "see date"
        }).`
      : "No active licence expiry is set — please renew to keep access.";

    const text = [
      `Hello,`,
      ``,
      `This is a payment reminder for ${opts.businessName} on POPS.`,
      `Billing period: ${opts.periodLabel}`,
      expiryLine,
      ``,
      `Please complete your monthly software payment so your system stays active.`,
      `If you already paid, ignore this message — your Super Admin will mark it received.`,
      ``,
      `— POPS Platform`,
    ].join("\n");

    const html = `
      <p>Hello,</p>
      <p>This is a payment reminder for <strong>${opts.businessName}</strong> on POPS.</p>
      <p>Billing period: <strong>${opts.periodLabel}</strong></p>
      <p>${expiryLine}</p>
      <p>Please complete your monthly software payment so your system stays active.</p>
      <p style="color:#666;font-size:12px">If you already paid, ignore this — Super Admin will mark payment received.</p>
    `;

    if (!this.transporter) {
      this.logger.log(
        `[dev] Licence reminder (${opts.kind}) → ${opts.to} · ${opts.businessName} · ${opts.periodLabel}`,
      );
      return false;
    }

    await this.transporter.sendMail({ from, to: opts.to, subject, text, html });
    return true;
  }
}
