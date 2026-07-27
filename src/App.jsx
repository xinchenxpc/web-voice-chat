import Login from './login'
import { loginUser } from './longinState'
import './App.css'

function page() { 
  if(loginUser() == null){
    return <Login className="login"/>
  }
  return <Home className="home"/>
}

function App() {
  return (
    <>
      {page()}
    </>
  )
}

export default App
