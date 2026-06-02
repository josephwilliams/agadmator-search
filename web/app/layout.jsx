import "./globals.css";

export const metadata = {
  title: "agadmator search",
  description: "Search agadmator's chess catalogue — players, openings, queen sacrifices.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
