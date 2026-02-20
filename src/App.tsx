import { ThemeProvider } from "./contexts/ThemeContext";
import { Header } from "./components/layouts/Header";
import { Footer } from "./components/layouts/Footer";
import Dashboard from "./pages/Dashboard";

export default function App() {
  return (
    <ThemeProvider>
      <div className="flex flex-col h-screen">
        <Header />
        <main className="flex-1 min-h-0">
          <Dashboard />
        </main>
        <Footer />
      </div>
    </ThemeProvider>
  );
}
