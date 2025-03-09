class WebrtcSlave {
    // signalingUrl, apikey
    constructor(signalingUrl, apikey) {
        this.signalingUrl = signalingUrl;
        this.apikey = apikey;
        this.signalingClient = null;
        this.peerConnection = null;
        this.dataChannel = null;
        this.callback = null;
        this.localStream = null;
    }

    // params: dataLabel, localStream
    async connect(remoteClientId, params){
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        const iceServers = [];
        iceServers.push({ urls: `stun:stun.l.google.com:19302` });
        const configuration = {
            iceServers,
            iceTransportPolicy: 'all',
        };
        this.peerConnection = new RTCPeerConnection(configuration);

        if (params?.dataLabel) {
            this.dataChannel = this.peerConnection.createDataChannel(params.dataLabel);
            this.peerConnection.addEventListener("datachannel", event => {
                event.channel.addEventListener("message", (e) => {
                    if (this.callback)
                        this.callback("data", { type: "message", data: e.data, label: e.target.label });
                });
            });
        }

        this.localStream = params?.localStream;

        this.peerConnection.addEventListener('icecandidate', async ({ candidate }) => {
            this.signalingClient.sendIceCandidate(candidate, remoteClientId);
        });

        this.peerConnection.addEventListener('track', event => {
            if (this.callback)
                this.callback('peer', { type: 'track', kind: event.track.kind, streams: event.streams, track: event.track });
        });

        this.peerConnection.addEventListener('connectionstatechange', (event) => {
            if (this.callback) this.callback('peer', { type: 'connectionstatechange', connectionState: event.target.connectionState });
        });
        this.peerConnection.addEventListener('negotiationneeded', (event) => {
            if (this.callback) this.callback('peer', { type: 'negotiationneeded' });
        });
        this.peerConnection.addEventListener('icegatheringstatechange', (event) => {
            if (this.callback) this.callback('peer', { type: 'icegatheringstatechange', iceGatheringState: event.target.iceGatheringState });
        });
        this.peerConnection.addEventListener('iceconnectionstatechange', (event) => {
            if (this.callback) this.callback('peer', { type: 'iceconnectionstatechange', iceConnectionState: event.target.iceConnectionState });
        });
        this.peerConnection.addEventListener('icecandidateerror', (event) => {
            if (this.callback) this.callback('peer', { type: 'icecandidateerror' });
        });
        this.peerConnection.addEventListener('signalingstatechange', (event) => {
            if (this.callback) this.callback('peer', { type: 'signalingstatechange', signalingState: event.target.signalingState });
        });

        var offer = await this.peerConnection.createOffer(
            {
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
            }
        );
        await this.peerConnection.setLocalDescription(offer);

        this.signalingClient.sendSdpOffer(offer, remoteClientId);
        if (this.callback) this.callback('peer', { type: 'sdpOffering' });
    }

    // params: channelId, clientId, password, 
    async start(params, callback) {
        this.stop();

        this.callback = callback;

        this.signalingClient = new WebrtcSignalingClient("slave", this.signalingUrl, this.apikey);

        this.signalingClient.on('open', async () => {
            if (callback) callback('signaling', { type: 'opened' });
        });

        this.signalingClient.on('close', async () => {
            if (callback) callback('signaling', { type: 'closed' });
        });

        this.signalingClient.on('error', async (message) => {
            if (callback) callback('signaling', { type: 'error', message: message });
        });

        this.signalingClient.on('sdpAnswer', async (answer, remoteClientId) => {
            if (this.peerConnection) {
                await this.peerConnection.setRemoteDescription(answer);
                if (callback) callback('peer', { type: 'sdpAnswered', remoteClientId: remoteClientId });
            }
        });

        this.signalingClient.on('sdpOffer', async (offer, remoteClientId) => {
            if (callback) callback('peer', { type: 'sdpOffered', remoteClientId: remoteClientId });

            await this.peerConnection.setRemoteDescription(offer);

            if( this.localStream ){
                this.localStream.getTracks().forEach(track => this.peerConnection.addTrack(track, this.localStream));
            }

            var answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            this.signalingClient.sendSdpAnswer(answer, remoteClientId);
            if (callback) callback('peer', { type: 'sdpOfferAnswer', remoteClientId: remoteClientId });
        });

        this.signalingClient.on('iceCandidate', (candidate, remoteClientId) => {
            if (this.peerConnection && candidate) {
                this.peerConnection.addIceCandidate(candidate);
            }
        });

        this.signalingClient.on('ready', async (remoteClientList) => {
            if (callback) callback('signaling', { type: 'ready', remoteClientList: remoteClientList });
        });

        this.signalingClient.open(params.channelId, params.clientId, params.password);

        if (callback) callback('signaling', { type: 'opening' });
    }

    disconnect(){
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
    }
    
    stop() {
        if (this.signalingClient) {
            this.signalingClient.close();
            this.signalingClient = null;
        }

        this.disconnect();
        this.channelId = null;
        this.clientId = null;
    }

    sendMessage(message) {
        if (!this.dataChannel)
            throw new Error("datachannel not exist");

        if (this.dataChannel.readyState != "open")
            throw new Error("client not ready");

        this.dataChannel.send(message);
    }
}