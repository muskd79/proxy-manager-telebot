import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", maxWidth: "400px", padding: "24px" }}>
        <h1 style={{ fontSize: "72px", fontWeight: 700, margin: 0, lineHeight: 1 }}>404</h1>
        <h2 style={{ fontSize: "20px", fontWeight: 600, marginTop: "8px" }}>Page not found</h2>
        <p style={{ color: "#666", marginTop: "8px", marginBottom: "24px" }}>
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          style={{
            display: "inline-block",
            padding: "8px 16px",
            backgroundColor: "#000",
            color: "#fff",
            borderRadius: "6px",
            textDecoration: "none",
            fontSize: "14px",
          }}
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
