export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Journalist Workspace</title>
      </head>
      <body style={{ fontFamily: "monospace", maxWidth: "900px", margin: "0 auto", padding: "1rem" }}>
        {children}
      </body>
    </html>
  )
}
