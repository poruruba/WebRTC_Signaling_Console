class WebrtcSlave {
    constructor(signalingUrl) {
        this.signalingUrl = signalingUrl;
        this.signalingClient = null;
        this.peerConnection = null;
        this.dataChannel = null;
        this.callback = null;
        this.localStream = null;
        this.remoteClientId = null;
    }

    async createPeerConnection(remoteClientId, dataLabel){
        const iceServers = [];
        iceServers.push({ urls: `stun:stun.l.google.com:19302` });
        const configuration = {
            iceServers,
            iceTransportPolicy: 'all',
        };
        this.peerConnection = new RTCPeerConnection(configuration);

        if (dataLabel) {
            this.dataChannel = this.peerConnection.createDataChannel(dataLabel);
            this.peerConnection.addEventListener("datachannel", event => {
                event.channel.addEventListener("message", (e) => {
                    if (this.callback)
                        this.callback("data", { type: "message", data: e.data, label: e.target.label });
                });
            });
        }

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
    }

    async startOffering(remoteClientId){
        var offer = await this.peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
        });
        await this.peerConnection.setLocalDescription(offer);

        this.signalingClient.sendSdpOffer(offer, remoteClientId);
        if (this.callback) this.callback('peer', { type: 'sdpOffering' });
    }

    async resolveAnswer(answer, remoteClientId){
        await this.peerConnection.setRemoteDescription(answer);
        if (this.callback) this.callback('peer', { type: 'sdpAnswered', remoteClientId: remoteClientId });
    }

    async processOffer(offer, remoteClientId, localStream){
        await this.peerConnection.setRemoteDescription(offer);
        if (this.callback) this.callback('peer', { type: 'sdpOffered', remoteClientId: remoteClientId });

        if( localStream )
            localStream.getTracks().forEach(track => this.peerConnection.addTrack(track, localStream));

        var answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        this.signalingClient.sendSdpAnswer(answer, remoteClientId);
        if (this.callback) this.callback('peer', { type: 'sdpAnswering', remoteClientId: remoteClientId });
    }

    // params: dataLabel, localStream
    async connect(remoteClientId, params){
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        this.localStream = params?.localStream;
        this.remoteClientId = remoteClientId;

        await this.createPeerConnection(remoteClientId, params?.dataLabel);

        await this.startOffering(remoteClientId);
    }

    // params: channelId, clientId, password, 
    async start(params, callback) {
        this.stop();

        this.callback = callback;

        this.signalingClient = new WebrtcSignalingClient("slave", this.signalingUrl);

        this.signalingClient.on('open', async () => {
            if (this.callback) this.callback('signaling', { type: 'opened' });
        });

        this.signalingClient.on('close', async () => {
            if (this.callback) this.callback('signaling', { type: 'closed' });
        });

        this.signalingClient.on('error', async (message) => {
            if (this.callback) this.callback('signaling', { type: 'error', message: message });
        });

        this.signalingClient.on('ready', async (remoteClientList) => {
            if (this.callback) this.callback('signaling', { type: 'ready', remoteClientList: remoteClientList });
        });

        this.signalingClient.on('sdpAnswer', async (answer, remoteClientId) => {
            await this.resolveAnswer(answer, remoteClientId);
        });

        this.signalingClient.on('sdpOffer', async (offer, remoteClientId) => {
            if( !this.peerConnection ){
                if( !this.callback )
                    return;

                var params = this.callback('signaling', { type: 'requestOffer', remoteClientId: remoteClientId });
                if( !params )
                    return;

                this.localStream = params?.localStream;

                await this.createPeerConnection(remoteClientId, params?.dataLabel);

                await this.processOffer(offer, remoteClientId, this.localStream);
                await this.startOffering(remoteClientId);
            }else{
                this.processOffer(offer, remoteClientId, this.localStream);
            }
        });

        this.signalingClient.on('iceCandidate', async (candidate, remoteClientId) => {
            if (candidate) {
                await this.peerConnection.addIceCandidate(candidate);
            }
        });

        this.signalingClient.open(params.channelId, params.clientId, params.password);
        if (this.callback) this.callback('signaling', { type: 'opening' });
    }

    disconnect(){
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
    }
    
    stop() {
        this.disconnect();
    }

    sendMessage(message) {
        if (!this.dataChannel || this.dataChannel.readyState != "open")
            throw new Error("client not ready");

        this.dataChannel.send(message);
    }
}