package org.sahaytasetu.disastermanagement;

import android.Manifest;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes;
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.DiscoveryOptions;
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;
import com.google.android.gms.tasks.Task;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(
    name = "NearbyMesh",
    permissions = {
        @Permission(alias = "legacyLocation", strings = { Manifest.permission.ACCESS_FINE_LOCATION }),
        @Permission(
            alias = "bluetooth",
            strings = {
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_ADVERTISE
            }
        ),
        @Permission(alias = "nearbyWifi", strings = { "android.permission.NEARBY_WIFI_DEVICES" })
    }
)
public class NearbyMeshPlugin extends Plugin {
    private static final String SERVICE_ID = "org.sahaytasetu.disastermanagement.mesh";
    private static final int MAX_PACKET_BYTES = 16 * 1024;

    private final Set<String> connectedEndpoints = Collections.newSetFromMap(new ConcurrentHashMap<>());
    private ConnectionsClient connectionsClient;
    private boolean meshStarted = false;

    @Override
    public void load() {
        connectionsClient = Nearby.getConnectionsClient(getContext());
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && !hasPermission("legacyLocation")) {
            requestPermissionForAlias("legacyLocation", call, "permissionCallback");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !hasPermission("bluetooth")) {
            requestPermissionForAlias("bluetooth", call, "permissionCallback");
            return;
        }
        if (Build.VERSION.SDK_INT >= 33 && !hasPermission("nearbyWifi")) {
            requestPermissionForAlias("nearbyWifi", call, "permissionCallback");
            return;
        }
        startMesh(call);
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && !hasPermission("legacyLocation")) {
            call.reject("Location permission is required to discover nearby devices.");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !hasPermission("bluetooth")) {
            call.reject("Bluetooth permission is required to discover nearby devices.");
            return;
        }
        if (Build.VERSION.SDK_INT >= 33 && !hasPermission("nearbyWifi")) {
            call.reject("Nearby Wi-Fi permission is required to discover nearby devices.");
            return;
        }
        startMesh(call);
    }

    private void startMesh(PluginCall call) {
        if (meshStarted) {
            resolveStatus(call);
            return;
        }
        meshStarted = true;
        startAdvertising();
        startDiscovery();
        resolveStatus(call);
    }

    private void startAdvertising() {
        connectionsClient
            .startAdvertising(
                "Sahayta Setu",
                SERVICE_ID,
                connectionLifecycleCallback,
                new AdvertisingOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build()
            )
            .addOnFailureListener(error -> emitStatus(error.getMessage()));
    }

    private void startDiscovery() {
        connectionsClient
            .startDiscovery(
                SERVICE_ID,
                endpointDiscoveryCallback,
                new DiscoveryOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build()
            )
            .addOnFailureListener(error -> emitStatus(error.getMessage()));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (connectionsClient != null) {
            connectionsClient.stopAdvertising();
            connectionsClient.stopDiscovery();
            connectionsClient.stopAllEndpoints();
        }
        connectedEndpoints.clear();
        meshStarted = false;
        emitStatus(null);
        resolveStatus(call);
    }

    @PluginMethod
    public void broadcastEmergencyPacket(PluginCall call) {
        String packet = call.getString("packet");
        if (packet == null || packet.isEmpty()) {
            call.reject("An SOS relay packet is required.");
            return;
        }

        byte[] bytes = packet.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_PACKET_BYTES) {
            call.reject("SOS relay packet exceeds the 16 KB safety limit.");
            return;
        }

        if (connectedEndpoints.isEmpty()) {
            JSObject result = new JSObject();
            result.put("sentCount", 0);
            result.put("peerCount", 0);
            call.resolve(result);
            return;
        }

        ArrayList<String> endpoints = new ArrayList<>(connectedEndpoints);
        Task<Void> sendTask = connectionsClient.sendPayload(endpoints, Payload.fromBytes(bytes));
        sendTask
            .addOnSuccessListener(unused -> {
                JSObject result = new JSObject();
                result.put("sentCount", endpoints.size());
                result.put("peerCount", connectedEndpoints.size());
                call.resolve(result);
            })
            .addOnFailureListener(error -> call.reject("Nearby SOS relay failed: " + error.getMessage()));
    }

    private final EndpointDiscoveryCallback endpointDiscoveryCallback = new EndpointDiscoveryCallback() {
        @Override
        public void onEndpointFound(String endpointId, DiscoveredEndpointInfo info) {
            if (!SERVICE_ID.equals(info.getServiceId())) return;
            connectionsClient
                .requestConnection("Sahayta Setu", endpointId, connectionLifecycleCallback)
                .addOnFailureListener(error -> emitStatus(error.getMessage()));
        }

        @Override
        public void onEndpointLost(String endpointId) {
            connectedEndpoints.remove(endpointId);
            emitStatus(null);
        }
    };

    private final ConnectionLifecycleCallback connectionLifecycleCallback = new ConnectionLifecycleCallback() {
        @Override
        public void onConnectionInitiated(String endpointId, ConnectionInfo info) {
            connectionsClient.acceptConnection(endpointId, payloadCallback);
        }

        @Override
        public void onConnectionResult(String endpointId, ConnectionResolution result) {
            if (result.getStatus().getStatusCode() == ConnectionsStatusCodes.STATUS_OK) {
                connectedEndpoints.add(endpointId);
            } else {
                connectedEndpoints.remove(endpointId);
            }
            emitStatus(null);
        }

        @Override
        public void onDisconnected(String endpointId) {
            connectedEndpoints.remove(endpointId);
            emitStatus(null);
        }
    };

    private final PayloadCallback payloadCallback = new PayloadCallback() {
        @Override
        public void onPayloadReceived(String endpointId, Payload payload) {
            byte[] bytes = payload.asBytes();
            if (bytes == null || bytes.length == 0 || bytes.length > MAX_PACKET_BYTES) return;

            JSObject event = new JSObject();
            event.put("packet", new String(bytes, StandardCharsets.UTF_8));
            event.put("endpointId", endpointId);
            notifyListeners("meshPacketReceived", event);
        }

        @Override
        public void onPayloadTransferUpdate(String endpointId, PayloadTransferUpdate update) {}
    };

    private void resolveStatus(PluginCall call) {
        JSObject status = new JSObject();
        status.put("active", meshStarted);
        status.put("peerCount", connectedEndpoints.size());
        call.resolve(status);
    }

    private void emitStatus(String error) {
        JSObject status = new JSObject();
        status.put("active", meshStarted);
        status.put("peerCount", connectedEndpoints.size());
        if (error != null && !error.isEmpty()) {
            status.put("error", error);
        }
        notifyListeners("meshStatus", status);
    }
}
