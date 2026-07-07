import { Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { CrmPage } from './pages/crm/CrmPage'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/crm/:tenantId"
        element={
          <ProtectedRoute>
            <CrmPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}

export default App
