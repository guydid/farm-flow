import Dashboard from './pages/Dashboard';
import Plots from './pages/Plots';
import Seedings from './pages/Seedings';
import SeedingDetail from './pages/SeedingDetail';
import WeighingCertificates from './pages/WeighingCertificates';
import WeighingDetail from './pages/WeighingDetail';
import Settings from './pages/Settings';
import Sheets from './pages/Sheets';
import Employees from './pages/Employees';
import EmployeeDetail from './pages/EmployeeDetail';
import Subscription from './pages/Subscription';
import AddEmployee from './pages/AddEmployee';
import EditEmployee from './pages/EditEmployee';
import Vehicles from './pages/Vehicles';
import AddVehicle from './pages/AddVehicle';
import VehicleDetail from './pages/VehicleDetail';
import EditVehicle from './pages/EditVehicle';
import FieldWorker from './pages/FieldWorker';
import AdminPanel from './pages/AdminPanel';
import FarmMembers from './pages/FarmMembers';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Dashboard": Dashboard,
    "Plots": Plots,
    "Seedings": Seedings,
    "SeedingDetail": SeedingDetail,
    "WeighingCertificates": WeighingCertificates,
    "WeighingDetail": WeighingDetail,
    "Settings": Settings,
    "Sheets": Sheets,
    "Employees": Employees,
    "EmployeeDetail": EmployeeDetail,
    "Subscription": Subscription,
    "AddEmployee": AddEmployee,
    "EditEmployee": EditEmployee,
    "Vehicles": Vehicles,
    "AddVehicle": AddVehicle,
    "VehicleDetail": VehicleDetail,
    "EditVehicle": EditVehicle,
    "FieldWorker": FieldWorker,
    "AdminPanel": AdminPanel,
    "FarmMembers": FarmMembers,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};