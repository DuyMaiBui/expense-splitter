import { redirect } from "next/navigation";

/** The app root is just an entry point into the group list. */
export default function HomePage() {
  redirect("/groups");
}
