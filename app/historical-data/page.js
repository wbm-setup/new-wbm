'use client'
import React, { useState, useEffect } from "react";
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { fetchHistoricalData, clearHistoricalData, fetchEmptyEvents } from '@/lib/dataProvider';
import { subscribeToTableChanges } from '@/lib/realtimeSubscription';
import ChartComponent from '@/components/ChartComponent';
import DownloadReport from '@/components/DownloadReport';
import Modal from '@/components/Modal';
import ConfirmationModal from '@/components/ConfirmationModal';  // Import the ConfirmationModal component
import { 
  calculateAverageFillRates, 
  calculateEmptyingEvents, 
  summarizeAnomalies, 
  summarizeSuddenChanges 
} from '@/utils/summaryDetailHelpers';

function Data() {
  const { session } = useAuth();
  const router = useRouter();
  const colors = [
    "rgba(255, 99, 132, 0.5)",  // red
    "rgba(54, 162, 235, 0.5)",  // blue
    "rgba(255, 206, 86, 0.5)",  // yellow
    "rgba(75, 192, 192, 0.5)",  // green
    "rgba(153, 102, 255, 0.5)", // purple
    "rgba(255, 159, 64, 0.5)"   // orange
  ];
  const colorMapping = {};
  const getColorForDevice = (deviceId) => {
    if (!colorMapping[deviceId]) {
      const index = Object.keys(colorMapping).length % colors.length;
      colorMapping[deviceId] = colors[index];
    }
    return colorMapping[deviceId];
  };
  const chartOptions = {
    scales: {
      y: {
        beginAtZero: true
      },
      x: {
        type: 'time',
        time: {
          unit: 'day',
          tooltipFormat: 'MM/dd/yyyy HH:mm',
          displayFormats: {
            hour: 'HH:mm',
            day: 'MM/dd/yyyy'
          }
        },
        ticks: {
          source: 'auto',
          autoSkip: true,
          maxTicksLimit: 20
        }
      }
    },
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 5
    },
    hover: {
      animationDuration: 5
    },
    responsiveAnimationDuration: 0
  };
  const [mockData, setHistorical] = useState([]);
  const [emptyingEvents, setEmptyingEvents] = useState({});
  const [activeTab, setActiveTab] = useState('fillLevels');
  const [fillLevelsOverTime, setFillLevelsOverTime] = useState({
    labels: [],
    datasets: []
  });
  const [lastSavedTimes, setLastSavedTimes] = useState({});
  const [devicePings, setDevicePings] = useState({});
  const [deviceInsights, setDeviceInsights] = useState({});
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [expandedPanel, setExpandedPanel] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalContent, setModalContent] = useState("");
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);  // Add state for confirmation modal

  const togglePanel = (id) => {
    setExpandedPanel(expandedPanel === id ? null : id);
  };
  const openModal = (title, content) => {
    setModalTitle(title);
    setModalContent(content);
    setModalOpen(true);
  };
  const closeModal = () => {
    setModalOpen(false);
    setModalTitle("");
    setModalContent("");
  };
  const openConfirmModal = () => {  // Function to open confirmation modal
    setConfirmModalOpen(true);
  };
  const closeConfirmModal = () => {  // Function to close confirmation modal
    setConfirmModalOpen(false);
  };
  const clearHistorical = async () => {
    const success = await clearHistoricalData();
    if (!success) {
      alert('Error clearing historical data');
    } else {
      setHistorical([]);
    }
    closeConfirmModal();  // Close modal after clearing
  };

  useEffect(() => {
    if (!session) {
      router.push('/login');
    } else {
      router.push('/historical-data');
    }
  }, [session, router]);

  useEffect(() => {
    const getHistorical = async () => {
      const data = await fetchHistoricalData();
      setHistorical(data);

      const emptyEvents = await fetchEmptyEvents();
      setEmptyingEvents(emptyEvents);

      // Calculate start and end dates based on the fetched data
      const dates = data.map(item => new Date(item.saved_time));
      const minDate = dates.length ? new Date(Math.min(...dates)) : new Date();
      let maxDate = dates.length ? new Date(Math.max(...dates)) : new Date();
      maxDate.setDate(maxDate.getDate() + 1);

      setStartDate(minDate.toISOString().split('T')[0]);
      setEndDate(maxDate.toISOString().split('T')[0]);
    };

    getHistorical();

    //Supabase realtime subscription and cleanup
    const unsubscribe = subscribeToTableChanges('historical', (payload) => {
      if(payload)
      {
        switch (payload.eventType) {
          case 'INSERT':
            setHistorical((prevData) => [...prevData, payload.new]);
            break;
          case 'UPDATE':
            setHistorical((prevData) =>
              prevData.map((item) =>
                item.id === payload.new.id ? payload.new : item
              )
            );
            break;
          case 'DELETE':
            setHistorical((prevData) =>
              prevData.filter((item) => item.id !== payload.old.id)
            );
            break;
          default:
            break;
        }
      }

    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    updateChartData();
  }, [mockData, startDate, endDate, emptyingEvents]);

  const updateChartData = () => {
    const filteredData = mockData.filter(item => {
      const itemDate = new Date(item.saved_time);
      const start = new Date(startDate);
      const end = new Date(endDate);
      // Include the whole end date by setting the time to the end of the day
      end.setHours(23, 59, 59, 999);
      return itemDate >= start && itemDate <= end;
    });

    const groupedByDevice = filteredData.reduce((acc, item) => {
      if (!acc[item.unique_id]) {
        acc[item.unique_id] = { data: [], lastSavedTime: null };
      }
      const dateToSave = new Date(item.saved_time);
      acc[item.unique_id].data.push({
        ...item,
        saved_time: dateToSave
      });

      if (!acc[item.unique_id].lastSavedTime || dateToSave > acc[item.unique_id].lastSavedTime) {
        acc[item.unique_id].lastSavedTime = dateToSave;
      }
      return acc;
    }, {});

    const datasets = [];
    const lastTimes = {};
    const pings = {};
    const insights = {};

    const averageFillRates = calculateAverageFillRates(filteredData);
    const recalculatedEmptyingEvents = calculateEmptyingEvents(filteredData);

    for (const [unique_id, { data, lastSavedTime }] of Object.entries(groupedByDevice)) {
      const color = getColorForDevice(unique_id);
      datasets.push({
        label: `Device ${unique_id}`,
        data: data.map(item => ({
          x: item.saved_time,
          y: item.level_in_percents
        })),
        borderColor: color,
        backgroundColor: color,
        fill: false,
        lineTension: 0.1
      });
      lastTimes[unique_id] = lastSavedTime.toLocaleString();
      pings[unique_id] = data.length;

      let anomalies = new Map();
      let suddenChanges = [];
      let previousItem = null;

      data.forEach(item => {
        if (item.level_in_percents < 0 || item.level_in_percents > 100) {
          anomalies.set(item.saved_time.toLocaleString(), `${item.level_in_percents}%`);
        }
        if (previousItem && Math.abs(previousItem.level_in_percents - item.level_in_percents) > 30) {
          suddenChanges.push({
            from: previousItem.level_in_percents,
            to: item.level_in_percents,
            start: previousItem.saved_time.toLocaleString(),
            end: item.saved_time.toLocaleString()
          });
        }
        previousItem = item;
      });

      insights[unique_id] = {
        totalPings: data.length,
        totalAnomalies: anomalies.size,
        totalSuddenChanges: suddenChanges.length,
        commonAnomalies: summarizeAnomalies(anomalies),
        frequentSuddenChangesSummary: summarizeSuddenChanges(suddenChanges),
        emptyingEvents: recalculatedEmptyingEvents[unique_id],
        averageFillRate: averageFillRates[unique_id]
      };
    }

    setFillLevelsOverTime({
      datasets
    });
    setLastSavedTimes(lastTimes);
    setDevicePings(pings);
    setDeviceInsights(insights);
  };

  const downloadCSV = () => {
    const filteredData = mockData.filter(item => {
      const itemDate = new Date(item.saved_time);
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      return itemDate >= start && itemDate <= end;
    });
  
    const headers = [
      "unique_id", "saved_time", "level_in_percents"
      // Add other relevant headers if necessary
    ];
  
    const csvData = [
      headers.join(","),
      ...filteredData.map(item => {
        // Convert the UTC time to Los Angeles time
        const laTime = new Date(item.saved_time).toLocaleString("en-US", {
          timeZone: "America/Los_Angeles",
          hour12: false,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
  
        return `${item.unique_id},${laTime},${item.level_in_percents}`;
      })
    ].join("\n");
  
    const filename = `historical_data_${startDate}_to_${endDate}.csv`;
  
    const blob = new Blob([csvData], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="mx-auto my-4 p-6 bg-white rounded-lg shadow-md text-gray-800 font-sans">
      <div className="flex justify-between items-center px-5 mb-10">
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="border border-gray-300 rounded px-2 py-2 text-lg"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="border border-gray-300 rounded px-2 py-2 text-lg"
        />
      </div>
      <div className="w-full bg-gray-200 rounded-lg p-8 shadow-md mb-8">
        <h2 className="text-2xl font-semibold text-gray-700">Fill Levels Over Time</h2>
        <div className="relative h-96">
          <ChartComponent data={fillLevelsOverTime} options={chartOptions} />
        </div>
      </div>
      <div className="flex justify-end mb-4 space-x-4">
        <DownloadReport
          deviceInsights={deviceInsights}
          devicePings={devicePings}
          startDate={startDate}
          endDate={endDate}
        />
        <button
          onClick={downloadCSV}
          className="bg-blue-500 text-white rounded px-4 py-2"
        >
          Download Historical CSV
        </button>
        <button
          onClick={openConfirmModal}  // Open confirmation modal on click
          className="bg-red-500 text-white rounded px-4 py-2"
        >
          Clear Historical Data
        </button>
      </div>
      <table className="min-w-full bg-white border border-gray-300 shadow-lg rounded-lg overflow-hidden">
        <thead className="bg-gray-100">
          <tr>
            <th className="py-2 px-4 border-b">Device ID</th>
            <th className="py-2 px-4 border-b">Total Pings</th>
            <th className="py-2 px-4 border-b">Times Emptied</th>
            <th className="py-2 px-4 border-b">Average Fill Rate</th>
            <th className="py-2 px-4 border-b">Out of Range</th>
            <th className="py-2 px-4 border-b">Sudden Changes</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(deviceInsights).map(([id, insight]) => (
            <tr key={id} className="hover:bg-gray-50">
              <td className="py-2 px-4 border-b text-center" style={{ borderLeft: `4px solid ${getColorForDevice(id)}` }}>{id}</td>
              <td className="py-2 px-4 border-b text-center">{insight.totalPings}</td>
              <td className="py-2 px-4 border-b text-center">{insight.emptyingEvents}</td>
              <td className="py-2 px-4 border-b text-center">{insight.averageFillRate.toFixed(2)}</td>
              <td className="py-2 px-4 border-b text-center">
                {insight.commonAnomalies.length > 0 ? (
                  <button
                    onClick={() => openModal('Out of Range Details', (
                      <ul className="list-disc list-inside">
                        {insight.commonAnomalies.map(anomaly => (
                          <li key={anomaly.level}>
                            Level: {anomaly.level}, Times: {anomaly.times}
                          </li>
                        ))}
                      </ul>
                    ))}
                    className="text-blue-600 underline"
                  >
                    {insight.commonAnomalies.length}
                  </button>
                ) : (
                  <span className="text-gray-500">None</span>
                )}
              </td>
              <td className="py-2 px-4 border-b text-center">
                {Object.entries(insight.frequentSuddenChangesSummary).length > 0 ? (
                  <button
                    onClick={() => openModal('Sudden Changes Details', (
                      <ul className="list-disc list-inside">
                        {Object.entries(insight.frequentSuddenChangesSummary).map(([change, times]) => (
                          <li key={change}>
                            Change: {change}, Times: {times.join(", ")}
                          </li>
                        ))}
                      </ul>
                    ))}
                    className="text-blue-600 underline"
                  >
                    {Object.entries(insight.frequentSuddenChangesSummary).length}
                  </button>
                ) : (
                  <span className="text-gray-500">None</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={modalTitle}
        content={modalContent}
      />
      <ConfirmationModal
        isOpen={confirmModalOpen}
        onClose={closeConfirmModal}
        onConfirm={clearHistorical}
        title="Confirm Deletion"
        message="Are you sure you want to clear all historical data? This action cannot be undone."
      />
    </div>
  );
}

export default Data;
