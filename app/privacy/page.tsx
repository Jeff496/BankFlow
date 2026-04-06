import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — BankFlow",
};

export default function PrivacyPage() {
  return (
    <main className="flex min-h-screen flex-col items-center p-8">
      <article className="w-full max-w-2xl space-y-6 py-12">
        <h1 className="text-3xl font-bold">Privacy Policy</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Last updated: April 6, 2026
        </p>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">What we collect</h2>
          <p className="text-sm leading-relaxed text-[var(--color-muted-foreground)]">
            When you sign in with Google, we receive your name, email address,
            and profile picture from your Google account. We also store budget
            and transaction data that you create within the app.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Google data usage</h2>
          <p className="text-sm leading-relaxed text-[var(--color-muted-foreground)]">
            BankFlow requests access to create Google Drive files on your behalf.
            This is used solely to export your budget data to a new Google
            Sheets spreadsheet. We do not read, modify, or delete any other
            files in your Google Drive.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">How we use your data</h2>
          <p className="text-sm leading-relaxed text-[var(--color-muted-foreground)]">
            Your data is used only to provide the BankFlow service — managing
            budgets, categorizing transactions, and exporting to Google Sheets.
            We do not sell, share, or use your data for advertising.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Data storage</h2>
          <p className="text-sm leading-relaxed text-[var(--color-muted-foreground)]">
            Your data is stored securely in Supabase with row-level security
            policies that ensure you can only access your own data. Group budget
            data is shared only with members you invite.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Deleting your data</h2>
          <p className="text-sm leading-relaxed text-[var(--color-muted-foreground)]">
            You can delete your budgets and transaction data at any time from
            within the app. To delete your account entirely, contact us and we
            will remove all associated data.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Contact</h2>
          <p className="text-sm leading-relaxed text-[var(--color-muted-foreground)]">
            If you have questions about this policy, reach out via the contact
            information on our GitHub repository.
          </p>
        </section>
      </article>
    </main>
  );
}
