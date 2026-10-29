import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, Form, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Anything opened from Shopify admin goes straight into the app.
  if (url.searchParams.get("shop") || url.searchParams.get("host") || url.searchParams.get("embedded")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const errors = actionData?.errors;

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Zion Cases Helpdesk</h1>
        <p className={styles.text}>
          Customer support for your Shopify store: a storefront request form, one inbox for every ticket and AI checks on customer photos.
        </p>
        {showForm && (
          <Form className={styles.form} method="post">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>{errors?.shop ?? "e.g: my-shop-domain.myshopify.com"}</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Storefront form</strong>. Customers pick their order and
            products, attach photos and track their request.
          </li>
          <li>
            <strong>Ticket inbox</strong>. Reply, assign to staff, add notes and
            use saved replies, with email updates to the customer.
          </li>
          <li>
            <strong>Photo checks</strong>. Flags AI-generated, edited or reused
            damage photos before you approve a claim.
          </li>
        </ul>
      </div>
    </div>
  );
}
