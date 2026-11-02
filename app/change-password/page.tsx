import Link from "next/link";

import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { Icon } from "@/components/Icon";

/**
 * Đổi mật khẩu (signed in). A thin page around the form so the flow also has a URL a person can
 * bookmark or be sent to; the form itself does all the work through the API.
 */
export default function ChangePasswordPage() {
  return (
    <main className="container stack">
      <div className="row row-between row-nowrap">
        <h1 className="row row-nowrap">
          <Icon name="key" size={26} />
          <span>Đổi mật khẩu</span>
        </h1>
        <Link className="btn btn-ghost" href="/profile" prefetch={false}>
          <Icon name="arrowLeft" />
          <span>Hồ sơ</span>
        </Link>
      </div>

      <section className="card stack">
        <ChangePasswordForm />
      </section>
    </main>
  );
}
