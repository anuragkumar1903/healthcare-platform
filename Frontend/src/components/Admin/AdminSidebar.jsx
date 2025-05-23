import  { useState } from "react";
import { BsLayoutSidebarInset } from "react-icons/bs";
import { FaUserDoctor } from "react-icons/fa6";
import { FaUser } from "react-icons/fa";
import { AiTwotoneMedicineBox } from "react-icons/ai";
import { FaBookMedical } from "react-icons/fa";
import { useSelector } from "react-redux";
import { FaUserCheck } from "react-icons/fa";
import { useNavigate } from "react-router-dom";

const AdminSidebar = () => {
    const [open, setOpen] = useState(false);
    const navigate=useNavigate();
    const user = useSelector((state) => state.auth.user);
     const sidebarItems = [
        { title: "Total appointment", icon: <FaBookMedical /> ,path:"/totalappointmentlist"},
        { title: "Registered Doctor", icon: <FaUserDoctor />, path:"/doctorlist" },
        { title: "registered User", icon: <FaUser />, path:"/userlist" },
        { title: "Verify Doctor", icon: <FaUserCheck />, path: "https://www.nmc.org.in/information-desk/indian-medical-register/" },
        { title: "Dashboard", icon: <FaBookMedical /> ,path:"/admindashboard"},
      ];

  return (
      <div
        className={`${
          open ? "w-[250px]" : "w-[60px]"
        } duration-400 px-0.5 py-1.5 s:p-4 flex flex-col pb-10 bg-emerald-500 text-black rounded-r-xl  justify-start sticky top-0`}
      >
        {/* Toggle Icon */}
        <div
          className={`${
            !open && "rotate-180 justify-center"
          } flex justify-end mb-6 mr-2 cursor-pointer`}
          onClick={() => setOpen(!open)}
        >
          <BsLayoutSidebarInset />
        </div>
  
        {/* Profile Picture */}
        {open && (
          <div className="flex flex-col items-center mb-12">
            <div className=" h-24 w-24 border shadow-lg rounded-full overflow-hidden">
              <img
                src={`data:image/png;base64,${user?.image}`}
                className="h-full w-full object-cover"
              />
            </div>
            <h2 className="mt-4 text-sm  text-gray-800 font-semibold">
              {user?.name}
            </h2>
          </div>
        )}
  
        {/* Sidebar Items */}
        <div className="space-y-6">
          {sidebarItems.map((item, index) => (          
            <div
              key={index}
              className={`flex items-center gap-4 cursor-pointer hover:bg-emerald-600 px-4 py-2 rounded-md ${
                !open && "justify-center"
              }`}
              onClick={() => navigate(item.path)} 
            >
              <div className="text-xl">{item.icon}</div>
              {open && (
                <span className="text-sm sm:text-lg  text-gray-800 font-medium"
                >
                  {item.title}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
}

export default AdminSidebar
