class WebrtcMaster {
    constructor(signalingUrl){
        this.signalingUrl = signalingUrl;
        this.peerList = [];
        this.signalingClient = null;
        this.callback = null;

        this.signalingClient = new WebrtcSignalingClient("master", this.signalingUrl);

        this.signalingClient.on('open', async () => {
            if (this.callback) this.callback('signaling', { type: 'opened' });
        });

        this.signalingClient.on('close', async () => {
            if (this.callback) this.callback('signaling', { type: 'closed' });
        });

        this.signalingClient.on('error', async (message) => {
            if (this.callback) this.callback('signaling', { type: 'error', message: message });
        });

        this.signalingClient.on('iceCandidate', async (candidate, remoteClientId) => {
            if (candidate){
                var peer = this.peerList.find(item => item.clientId == remoteClientId);
                if( peer )
                    await peer.peerConnection.addIceCandidate(candidate);
            }
        });        
    }
    
    async startOffering(peer){
        var offer = await peer.peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
        });
        await peer.peerConnection.setLocalDescription(offer);

        this.signalingClient.sendSdpOffer(offer, peer.clientId);
        if (this.callback) this.callback('peer', { type: 'sdpOffering', remoteClientId: peer.clientId });
    }

    async resolveAnswer(peer, answer){
        await peer.peerConnection.setRemoteDescription(answer);
        if (this.callback) this.callback('peer', { type: 'sdpAnswered', remoteClientId: peer.clientId });
    }

    async processOffer(peer, offer, localStream){
        await peer.peerConnection.setRemoteDescription(offer);
        if (this.callback) this.callback('peer', { type: 'sdpOffered', remoteClientId: peer.clientId });

        if( localStream )
            localStream.getTracks().forEach(track => peer.peerConnection.addTrack(track, localStream));

        var answer = await peer.peerConnection.createAnswer();
        await peer.peerConnection.setLocalDescription(answer);

        this.signalingClient.sendSdpAnswer(answer, peer.clientId);
        if (this.callback) this.callback('peer', { type: 'sdpAnswering', remoteClientId: peer.clientId });
    }

    // params: localStream, channelId, clientId, password, dataLabel, requestOffer
    async start(params, callback) {
        this.callback = callback;
        let requestOffer = params.requestOffer;
        let dataLabel = params.dataLabel;
        let localStream = params.localStream;

        this.signalingClient.on('sdpOffer0', async (offer, remoteClientId) => {
            var peer = this.peerList.find(item => item.clientId == remoteClientId );
            if( peer )
                peer.peerConnection.close();

            const iceServers = [];
            iceServers.push({ urls: `stun:stun.l.google.com:19302` });
            const configuration = {
                iceServers,
                iceTransportPolicy: 'all',
            };
            var peerConnection = new RTCPeerConnection(configuration);
            if( peer ){
                peer.peerConnection = peerConnection;
                peer.tracks = [];
                peer.dataChannel = null;
            }else{
                peer = {
                    clientId: remoteClientId,
                    peerConnection: peerConnection,
                    tracks: [],
                    dataChannel: null
                };
                this.peerList.push(peer);
            }
            
            if (dataLabel) {
                peer.dataChannel = peerConnection.createDataChannel(dataLabel);
                peerConnection.addEventListener("datachannel", event => {
                    event.channel.addEventListener("message", (e) => {
                        if (this.callback) this.callback("data", { type: 'message', remoteClientId: remoteClientId, data: e.data, label: e.target.label });
                    });
                });
            }

            peerConnection.addEventListener('track', event => {
                peer.tracks.push(event.track);
                if (this.callback) this.callback('peer', { type: 'track', remoteClientId: remoteClientId, kind: event.track.kind, streams: event.streams, track: event.track });
            });

            peerConnection.addEventListener('icecandidate', async ({ candidate }) => {
                this.signalingClient.sendIceCandidate(candidate, remoteClientId);
            });

            peerConnection.addEventListener('connectionstatechange', (event) => {
                if (this.callback) callback('peer', { type: 'connectionstatechange', remoteClientId: remoteClientId, connectionState: event.target.connectionState });
            });
            peerConnection.addEventListener('negotiationneeded', (event) => {
                if (this.callback) this.callback('peer', { type: 'negotiationneeded', remoteClientId: remoteClientId });
            });
            peerConnection.addEventListener('icegatheringstatechange', (event) => {
                if (this.callback) this.callback('peer', { type: 'icegatheringstatechange', remoteClientId: remoteClientId, iceGatheringState: event.target.iceGatheringState });
            });
            peerConnection.addEventListener('iceconnectionstatechange', (event) => {
                if (this.callback) this.callback('peer', { type: 'iceconnectionstatechange', remoteClientId: remoteClientId, iceConnectionState: event.target.iceConnectionState });
            });
            peerConnection.addEventListener('icecandidateerror', (event) => {
                if (this.callback) this.callback('peer', { type: 'icecandidateerror', remoteClientId: remoteClientId });
            });
            peerConnection.addEventListener('signalingstatechange', (event) => {
                if (this.callback) this.callback('peer', { type: 'signalingstatechange', remoteClientId: remoteClientId, signalingState: event.target.signalingState });
            });
            
            await this.processOffer(peer, offer, localStream);

            if( requestOffer ){
                this.signalingClient.on('sdpAnswer', async (answer, remoteClientId2) => {
                    if( remoteClientId != remoteClientId2 )
                        return;
                    await this.resolveAnswer(peer, answer);
                });
                await this.startOffering(peer);
            }
        });

        await this.signalingClient.open(params.channelId, params.clientId, params.password);
        if (this.callback) this.callback('signaling', { type: 'opening' });
    }

    getRemoteClientList(){
        return this.peerList;
    }

    getMediaStream(remoteClientId){
        var peer = this.peerList.find(item => item.clientId == remoteClientId);
        return new MediaStream(peer.tracks);
    }

    disconnect(remoteClientId) {
        var peerIndex = this.peerList.findIndex(item => item.clientId == remoteClientId);
        if (peerIndex) {
            this.peerList[peerIndex].peerConnection.close();
            this.peerList.splice(peerIndex, 1);
        }
    }

    stop() {
        if (this.signalingClient) {
            this.signalingClient.close();
            this.signalingClient = null;
        }

        for( let item of this.peerList){
            item.peerConnection.close();
        }
        this.peerList = [];
    }

    sendMessage(message, remoteClientId) {
        if (remoteClientId) {
            var peer = this.peerList.find(item => item.clientId == remoteClientId);
            if (!peer)
                throw new Error("client not found");

            if (!peer.dataChannel || peer.dataChannel.readyState != "open")
                throw new Error("client not ready");

            peer.dataChannel.send(message);
        } else {
            for( let item of this.peerList){
                try {
                    if (item && item.dataChannel && item.dataChannel.readyState == 'open')
                        item.dataChannel.send(message);
                } catch (e) {
                    console.log(e);
                }
            }
        }
    }
}