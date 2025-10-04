// Content.jsx
import MarkdownRenderer from '../components/MarkdownRenderer';
import { useState, useEffect } from 'react';

function Content() {
	const homeMdPath = require('../markdown/home.md');

	const [homeMd, setHomeMd] = useState('');
	const fetchHomeMd = async () => {
		const homeMd = await fetch(homeMdPath).then(res => res.text());
		setHomeMd(homeMd);
	}

	useEffect(() => {
		fetchHomeMd();
		console.log('home.md loaded');
	}, []);

	return (
		<div className="home-content">
			<MarkdownRenderer content={homeMd} />
		</div>
	);
}

export default Content;
