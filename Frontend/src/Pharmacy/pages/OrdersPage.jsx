import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import { fetchMyOrders, updateOrderStatus } from "../store/pharmacySlice";
import OrderStatusBadge from "../Components/OrderStatusBadge";
import { FiPackage } from "react-icons/fi";
import socket from "../../socket";

export default function OrdersPage() {
  const dispatch  = useDispatch();
  const { orders, loading } = useSelector((s) => s.pharmacy);
  const userId    = useSelector((s) => s.auth.user?._id);

  useEffect(() => {
    dispatch(fetchMyOrders());
  }, [dispatch]);

  // Join the user's personal order room and listen for live status updates
  useEffect(() => {
    if (!userId) return;

    socket.emit("order:join", userId);

    const onShipmentStatus = ({ orderId, status }) => {
      dispatch(updateOrderStatus({ orderId, status }));
    };

    socket.on("shipment:status", onShipmentStatus);

    return () => {
      socket.off("shipment:status", onShipmentStatus);
      socket.emit("order:leave", userId);
    };
  }, [userId, dispatch]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">My Orders</h1>

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl h-28 animate-pulse" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-24 text-gray-400">
            <FiPackage className="text-7xl mx-auto mb-4 text-teal-200" />
            <p className="text-lg">No orders yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            <AnimatePresence>
              {orders.map((order, i) => (
                <motion.div
                  key={order.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-white rounded-xl shadow-sm p-5"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-gray-800">{order.orderNumber}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(order.createdAt).toLocaleDateString("en-IN", {
                          day: "numeric", month: "short", year: "numeric",
                        })}
                      </p>
                    </div>
                    <OrderStatusBadge status={order.status} />
                  </div>

                  {/* Items */}
                  <div className="text-sm text-gray-600 space-y-1 mb-3">
                    {order.items.map((item, j) => (
                      <div key={j} className="flex justify-between">
                        <span>{item.medicineName} × {item.quantity}</span>
                        <span>₹{(item.priceAtPurchase * item.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between border-t pt-3">
                    <span className="text-sm text-gray-500">{order.paymentMethod}</span>
                    <span className="font-bold text-teal-600">₹{order.totalAmount}</span>
                  </div>

                  <OrderTracker status={order.status} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

const STEPS = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED"];

function OrderTracker({ status }) {
  const currentIdx = STEPS.indexOf(status);
  if (status === "CANCELLED") return (
    <p className="text-xs text-red-500 mt-3">Order cancelled</p>
  );

  return (
    <div className="mt-4 flex items-center gap-0">
      {STEPS.map((step, i) => (
        <div key={step} className="flex items-center flex-1 last:flex-none">
          <div className={`w-3 h-3 rounded-full shrink-0 transition-colors duration-500 ${i <= currentIdx ? "bg-teal-500" : "bg-gray-200"}`} />
          {i < STEPS.length - 1 && (
            <div className={`flex-1 h-0.5 transition-colors duration-500 ${i < currentIdx ? "bg-teal-500" : "bg-gray-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}
