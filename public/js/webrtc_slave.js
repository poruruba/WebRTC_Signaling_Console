class WebrtcSlave {
    constructor(signalingUrl, role = 'slave') {
        this.peerConnection = null;
        this.dataChannel = null;
        this.callback = null;
        this.localStream = null;
        this.remoteClientId = null;

        this.signalingClient = new WebrtcSignalingClient(role, signalingUrl);

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
            await this.resolveAnswer(remoteClientId, answer);
        });

        this.signalingClient.on('iceCandidate', async (candidate, remoteClientId) => {
            console.log("signalingClient.on 'iceCandidate'");
            if( this.remoteClientId != remoteClientId )
                return;

            if (candidate) {
                await this.peerConnection.addIceCandidate(candidate);
            }
        });
    }

    createPeerConnection(remoteClientId, dataLabel){
        this.remoteClientId = remoteClientId;

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
                    if (this.callback) this.callback("data", { type: "message", remoteClientId: remoteClientId, data: e.data, label: e.target.label });
                });
            });
        }

        this.peerConnection.addEventListener('icecandidate', async ({ candidate }) => {
            console.log("sendIceCandidate 'iceCandidate'");
            this.signalingClient.sendIceCandidate(candidate, remoteClientId);
        });

        this.peerConnection.addEventListener('track', event => {
            if (this.callback) this.callback('peer', { type: 'track', kind: event.track.kind, streams: event.streams, track: event.track });
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

    async startOffering(init){
        var offer = await this.peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
        });
        await this.peerConnection.setLocalDescription(offer);

        if( init ){
            this.signalingClient.sendSdpOffer1(offer, this.remoteClientId);
            if (this.callback) this.callback('peer', { type: 'sdpOffering1' });
        }else{
            this.signalingClient.sendSdpOffer2(offer, this.remoteClientId);
            if (this.callback) this.callback('peer', { type: 'sdpOffering2' });
        }
    }

    async resolveAnswer(remoteClientId, answer){
        if( this.remoteClientId != remoteClientId )
            return;

        await this.peerConnection.setRemoteDescription(answer);
        if (this.callback) this.callback('peer', { type: 'sdpAnswered', remoteClientId: this.remoteClientId });
    }

    async processOffer(remoteClientId, offer, localStream){
        if( this.remoteClientId != remoteClientId )
            return;

        await this.peerConnection.setRemoteDescription(offer);
        if (this.callback) this.callback('peer', { type: 'sdpOffered', remoteClientId: remoteClientId });

        if( localStream )
            localStream.getTracks().forEach(track => this.peerConnection.addTrack(track, localStream));

        var answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        this.signalingClient.sendSdpAnswer(answer, remoteClientId);
        if (this.callback) this.callback('peer', { type: 'sdpAnswering', remoteClientId: remoteClientId });
    }

    // params: localStream, dataLabel
    async connect(remoteClientId, params){
        this.disconnect();

        this.localStream = params?.localStream;

        this.createPeerConnection(remoteClientId, params?.dataLabel);

        await this.startOffering(true);
    }

    // params: channelId, clientId, password, 
    async start(params, callback) {
        this.callback = callback;
        let localStream = params.localStream;
        let dataLabel = params.dataLabel;
        let autoSlaveConnect = params.autoSlaveConnect;

        this.signalingClient.on('sdpOffer1', async (offer, remoteClientId) => {
            if( !autoSlaveConnect )
                return;
            if( !this.peerConnection )
                this.disconnect();

            this.createPeerConnection(remoteClientId, dataLabel);

            await this.processOffer(remoteClientId, offer, localStream);
            await this.startOffering();
        });

        this.signalingClient.on('sdpOffer2', async (offer, remoteClientId) => {
            if( this.remoteClientId != remoteClientId )
                return;
            this.processOffer(remoteClientId, offer, this.localStream);
        });

        await this.signalingClient.open(params.channelId, params.clientId, params.password);
        if (this.callback) this.callback('signaling', { type: 'opening' });
    }

    disconnect(){
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
            this.remoteClientId = null;
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