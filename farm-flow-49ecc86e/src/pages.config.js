import { lazy } from 'react';
import __Layout from './Layout.jsx';

// Route components are lazy-loaded so each page ships as its own chunk —
// the login screen and first paint no longer drag in every page + its deps.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Plots = lazy(() => import('./pages/Plots'));
const Seedings = lazy(() => import('./pages/Seedings'));
const SeedingDetail = lazy(() => import('./pages/SeedingDetail'));
const WeighingCertificates = lazy(() => import('./pages/WeighingCertificates'));
const WeighingDetail = lazy(() => import('./pages/WeighingDetail'));
const Settings = lazy(() => import('./pages/Settings'));
const Sheets = lazy(() => import('./pages/Sheets'));
const Employees = lazy(() => import('./pages/Employees'));
const EmployeeDetail = lazy(() => import('./pages/EmployeeDetail'));
const Subscription = lazy(() => import('./pages/Subscription'));
const AddEmployee = lazy(() => import('./pages/AddEmployee'));
const EditEmployee = lazy(() => import('./pages/EditEmployee'));
const Vehicles = lazy(() => import('./pages/Vehicles'));
const AddVehicle = lazy(() => import('./pages/AddVehicle'));
const VehicleDetail = lazy(() => import('./pages/VehicleDetail'));
const EditVehicle = lazy(() => import('./pages/EditVehicle'));
const FieldWorker = lazy(() => import('./pages/FieldWorker'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));
const FarmMembers = lazy(() => import('./pages/FarmMembers'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Invoices = lazy(() => import('./pages/Invoices'));
const InvoiceDetail = lazy(() => import('./pages/InvoiceDetail'));
const Attendance = lazy(() => import('./pages/Attendance'));


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
    "Suppliers": Suppliers,
    "Invoices": Invoices,
    "InvoiceDetail": InvoiceDetail,
    "Attendance": Attendance,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};
